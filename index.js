    import dotenv from 'dotenv';
    dotenv.config();

    import bcrypt from 'bcrypt';
    import bodyParser from 'body-parser';
    import express from 'express';
    import mysql from 'mysql2';
    import cors from 'cors';
    import nodemailer from 'nodemailer';

    const app = express();
    app.use(cors()); 
    app.use(bodyParser.json());
    const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    });


    db.connect(err => {
    if (err) throw err;
    console.log('Connected to MySQL database');
    });


    app.post('/users/register', async (req, res) => {
    const { full_name, email, password } = req.body;
    if (!full_name || !email || !password)
        return res.status(400).json({ msg: "All fields required" });

    const hashedPassword = await bcrypt.hash(password, 10);
    db.query(
        'INSERT INTO users (full_name, email, password) VALUES (?, ?, ?)',
        [full_name, email, hashedPassword],
        (err) => {
        if (err) {
            if (err.code === 'ER_DUP_ENTRY')
            return res.status(400).json({ msg: "Email already registered" });
            return res.status(500).json({ error: err });
        }
        res.status(201).json({ msg: "User registered successfully" });
        }
    );
    });


    app.post('/users/login', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password)
        return res.status(400).json({ msg: "Email and password required" });

    db.query('SELECT * FROM users WHERE email = ?', [email], async (err, results) => {
        if (err) return res.status(500).json({ error: err });
        if (results.length === 0)
        return res.status(400).json({ msg: "Invalid email or password" });

        const user = results[0];
        const validPass = await bcrypt.compare(password, user.password);
        if (!validPass) return res.status(400).json({ msg: "Invalid email or password" });

        res.json({
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        role: user.role,
        balance: user.balance
        });
    });
    });


    app.get('/users', (req, res) => {
        const sql = `
          SELECT 
            u.id, 
            u.full_name, 
            u.email, 
            u.balance,
            CASE WHEN a.user_id IS NOT NULL THEN true ELSE false END AS has_account,
            a.status,
            a.account_type,
            a.account_number
          FROM users u
          LEFT JOIN account a ON u.id = a.user_id
          WHERE u.role = "customer"
          GROUP BY u.id
        `;
    
        db.query(sql, (err, results) => {
            if (err) return res.status(500).json({ error: err });
            res.json(results);
        });
    });    
      

      app.post('/accounts', (req, res) => {
        const { user_id } = req.body;
    
        if (!user_id)
            return res.status(400).json({ msg: "User ID is required" });
    
        // توليد رقم حساب عشوائي مكون من 10 أرقام
        const account_number = Math.floor(1000000000 + Math.random() * 9000000000);
        const account_type = "savings";
    
        db.query(
            'INSERT INTO account (user_id, account_number, account_type) VALUES (?, ?, ?)',
            [user_id, account_number, account_type],
            (err) => {
                if (err) {
                    if (err.code === 'ER_DUP_ENTRY')
                        return res.status(400).json({ msg: "Account number already exists" });
                    return res.status(500).json({ error: err });
                }
                res.status(201).json({ msg: "Account created successfully", account_number });
            }
        );
    });
    


    app.get('/accounts/:id', (req, res) => {
    const accountId = req.params.id;
    db.query('SELECT * FROM account WHERE user_id = ?', [accountId], (err, results) => {
        if (err) return res.status(500).json({ error: err });
        if (results.length === 0) return res.status(404).json({ msg: "Account not found" });
        res.json(results[0]);
    });
    });


    app.post('/accounts/:id', (req, res) => {
    const accountId = req.params.id;
    const { account_type} = req.body;
    db.query(
        'UPDATE account SET account_type = ? WHERE user_id = ?',
        [account_type, accountId],
        (err, results) => {
        if (err) return res.status(500).json({ error: err });
        if (results.affectedRows === 0) return res.status(404).json({ msg: "Account not found" });
        res.json({ msg: "Account updated" });
        }
    );
    });


    app.post('/accounts/:id/deactivate', (req, res) => {
    const user_id = req.params.id;
    db.query('UPDATE account SET status = "deactivated" WHERE user_id = ?', [user_id], (err, results) => {
        if (err) return res.status(500).json({ error: err });
        if (results.affectedRows === 0) return res.status(404).json({ msg: "Account not found" });
        res.json({ msg: "Account deactivated" });
    });
    });


    app.post('/accounts/:id/freeze', (req, res) => {
    const user_id = req.params.id;
    const freezeDays = parseInt(req.body.days);

    if (!freezeDays || freezeDays <= 0) {
        return res.status(400).json({ msg: "Please provide a valid number of days for freezing" });
    }

    const freezeUntil = new Date();
    freezeUntil.setDate(freezeUntil.getDate() + freezeDays);

    db.query(
        'UPDATE account SET status = "frozen", freeze_until = ? WHERE user_id = ?',
        [freezeUntil, user_id],
        (err, results) => {
        if (err) return res.status(500).json({ error: err });
        if (results.affectedRows === 0) return res.status(404).json({ msg: "Account not found" });
        res.json({ msg: `Account frozen for ${freezeDays} days` });
        }
    );
    });




    app.post('/accounts/:id/unfreeze', (req, res) => {
    const user_id = req.params.id;
    db.query(
        'UPDATE account SET status = "active", freeze_until = NULL WHERE user_id = ?',
        [user_id],
        (err, results) => {
        if (err) return res.status(500).json({ error: err });
        if (results.affectedRows === 0) return res.status(404).json({ msg: "Account not found" });
        res.json({ msg: "Account unfrozen" });
        }
    );
    });


    app.post('/accounts/:id/delete', (req, res) => {
        const user_id = req.params.id;
      
        // نستخدم استعلام لحذف الحساب بالمعرف
        const sql = 'DELETE FROM account WHERE user_id = ?';
      
        db.query(sql, [user_id], (err, results) => {
          if (err) {
            console.error(err);
            return res.status(500).json({ message: 'Internal server error' });
          }
          if (results.affectedRows === 0) {
            return res.status(404).json({ message: 'Account not found' });
          }
          res.json({ message: 'Account deleted successfully' });
        });
      });


      app.post('/transfers', (req, res) => {
        const { from_email, to_email, amount } = req.body;
        const now = new Date().toLocaleString();
    
        if (!from_email || !to_email || !amount || amount <= 0)
            return res.status(400).json({ msg: "Invalid input" });
    
        // جلب بيانات المرسل: balance و id و email
        db.query('SELECT id, balance, email FROM users WHERE email = ?', [from_email], (err, fromUserResult) => {
            if (err) return res.status(500).json({ error: err });
            if (fromUserResult.length === 0) return res.status(404).json({ msg: "Sender not found" });
    
            const from_user_id = fromUserResult[0].id;
    
            if (fromUserResult[0].balance < amount)
                return res.status(400).json({ msg: "Insufficient balance" });
    
            // جلب نوع الحساب للمرسل
            db.query('SELECT account_type FROM account WHERE user_id = ?', [from_user_id], (err, fromAccountResult) => {
                if (err) return res.status(500).json({ error: err });
                if (fromAccountResult.length === 0) return res.status(404).json({ msg: "Sender account not found" });
    
                if (fromAccountResult[0].account_type !== 'savings') {
                    return res.status(400).json({ msg: "Sender account type not allowed for transfer" });
                }
    
                // جلب بيانات المستقبل (id، balance، email)
                db.query('SELECT id, balance, email FROM users WHERE email = ?', [to_email], (err, toUserResult) => {
                    if (err) return res.status(500).json({ error: err });
                    if (toUserResult.length === 0) return res.status(404).json({ msg: "Receiver not found" });
    
                    const to_user_id = toUserResult[0].id;
    
                    // جلب نوع الحساب للمستقبل
                    db.query('SELECT account_type FROM account WHERE user_id = ?', [to_user_id], (err, toAccountResult) => {
                        if (err) return res.status(500).json({ error: err });
                        if (toAccountResult.length === 0) return res.status(404).json({ msg: "Receiver account not found" });
    
                        if (toAccountResult[0].account_type !== 'savings') {
                            return res.status(400).json({ msg: "Receiver account type not allowed for transfer" });
                        }
    
                        // خصم المبلغ من المرسل
                        db.query('UPDATE users SET balance = balance - ? WHERE id = ?', [amount, from_user_id], (err) => {
                            if (err) return res.status(500).json({ error: err });
    
                            // إضافة المبلغ للمستقبل
                            db.query('UPDATE users SET balance = balance + ? WHERE id = ?', [amount, to_user_id], (err) => {
                                if (err) return res.status(500).json({ error: err });
    
                                // إرسال إيميلات تأكيد المعاملة
                                sendEmail(
                                    from_email,
                                    "💸 Transaction Sent Successfully",
                                    `<div style="font-family: Arial, sans-serif; padding: 20px; background-color: #f5f5f5;">
                                        <h2 style="color: #2c3e50;">✅ Transaction Confirmation</h2>
                                        <p>Dear Customer,</p>
                                        <p>You have successfully <strong>sent</strong> <span style="color: green;"><strong>$${amount}</strong></span>.</p>
                                        <p>Date and Time: <strong>${now}</strong></p>
                                        <hr style="margin: 20px 0;" />
                                        <p style="font-size: 14px; color: #888;">Thank you for using our banking service.</p>
                                        <p style="font-size: 12px; color: #aaa;">Bank App Team</p>
                                    </div>`
                                );
    
                                sendEmail(
                                    to_email,
                                    "💸 You Have Received a Transaction",
                                    `<div style="font-family: Arial, sans-serif; padding: 20px; background-color: #f5f5f5;">
                                        <h2 style="color: #2c3e50;">✅ Transaction Received</h2>
                                        <p>Dear Customer,</p>
                                        <p>You have successfully <strong>received</strong> <span style="color: green;"><strong>$${amount}</strong></span> from <strong>${from_email}</strong>.</p>
                                        <p>Date and Time: <strong>${now}</strong></p>
                                        <hr style="margin: 20px 0;" />
                                        <p style="font-size: 14px; color: #888;">Thank you for using our banking service.</p>
                                        <p style="font-size: 12px; color: #aaa;">Bank App Team</p>
                                    </div>`
                                );
    
                                // تسجيل المعاملة في جدول transactions
                                db.query(
                                    'INSERT INTO transactions (from_user_id, to_user_id, amount) VALUES (?, ?, ?)',
                                    [from_user_id, to_user_id, amount],
                                    (err) => {
                                        if (err) return res.status(500).json({ error: err });
                                        res.json({ msg: "Transfer successful" });
                                    }
                                );
                            });
                        });
                    });
                });
            });
        });
    });
    
    



    app.get('/transactions', (req, res) => {
        const { type } = req.query;
    
        let sql = `
            SELECT 
                t.*, 
                sender.full_name AS sender_name, 
                receiver.full_name AS receiver_name 
            FROM transactions t
            JOIN users sender ON t.from_user_id = sender.id
            JOIN users receiver ON t.to_user_id = receiver.id
            WHERE 1=1
        `;
    
        let params = [];
    
        if (type === 'sent') {
            sql += ' AND t.from_user_id IS NOT NULL';
        } else if (type === 'received') {
            sql += ' AND t.to_user_id IS NOT NULL';
        }
    
        db.query(sql, params, (err, results) => {
            if (err) return res.status(500).json({ error: err });
            res.json(results);
        });
    });
    

    app.get('/users/:userId/accounts', (req, res) => {
    const userId = req.params.userId;
    db.query('SELECT * FROM account WHERE user_id = ?', [userId], (err, results) => {
        if (err) return res.status(500).json({ error: err });
        res.json(results);
    });
    });

    app.get('/', (req, res) => {
        res.send(`
          <h1>Banking API Endpoints</h1>
          <ul>
            <li><strong>POST</strong> /users/register – Register a new user</li>
            <li><strong>POST</strong> /users/login – Login user</li>
            <li><strong>POST</strong> /accounts – Create new account</li>
            <li><strong>GET</strong> /accounts/:id – Get account details by ID</li>
            <li><strong>PUT</strong> /accounts/:id – Update account type or status</li>
            <li><strong>PUT</strong> /accounts/:id/deactivate – Deactivate account</li>
            <li><strong>PUT</strong> /accounts/:id/freeze – Freeze account for given days</li>
            <li><strong>PUT</strong> /accounts/:id/unfreeze – Unfreeze account</li>
            <li><strong>POST</strong> /transfers – Transfer money between accounts</li>
            <li><strong>GET</strong> /transactions/:userId – Get all transactions (sent & received)</li>
            <li><strong>GET</strong> /transactions/:userId?type=sent – Get only sent transactions</li>
            <li><strong>GET</strong> /transactions/:userId?type=received – Get only received transactions</li>
            <li><strong>GET</strong> /users/:userId/accounts – Get all accounts of a user</li>
          </ul>
        `);
      });
      
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: 'gannaahmed572@gmail.com',
            pass: 'kpjz vdkq driq umnz'
        }
        });
    
     const sendEmail = (to, subject, html) => {
        transporter.sendMail({
            from: '"Bank App" <gannaahmed572@gmail.com>',
            to: to,
            subject: subject,
            text: html
        }, (err, info) => {
            if (err) console.error(err);
            else console.log("Email sent:", info.response);
        });
    };
    