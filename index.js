    import dotenv from 'dotenv';
    dotenv.config();

    import bcrypt from 'bcrypt';
    import bodyParser from 'body-parser';
    import express from 'express';
    import mysql from 'mysql2';
    import cors from 'cors';

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
            u.id, u.full_name, u.email, u.balance,
            CASE WHEN a.user_id IS NOT NULL THEN true ELSE false END AS has_account
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
    const { user_id, account_number, account_type } = req.body;
    if (!user_id || !account_number || !account_type)
        return res.status(400).json({ msg: "All fields required" });

    db.query(
        'INSERT INTO account (user_id, account_number, account_type) VALUES (?, ?, ?)',
        [user_id, account_number, account_type],
        (err) => {
        if (err) {
            if (err.code === 'ER_DUP_ENTRY')
            return res.status(400).json({ msg: "Account number already exists" });
            return res.status(500).json({ error: err });
        }
        res.status(201).json({ msg: "Account created successfully" });
        }
    );
    });


    app.get('/accounts/:id', (req, res) => {
    const accountId = req.params.id;
    db.query('SELECT * FROM account WHERE account_id = ?', [accountId], (err, results) => {
        if (err) return res.status(500).json({ error: err });
        if (results.length === 0) return res.status(404).json({ msg: "Account not found" });
        res.json(results[0]);
    });
    });


    app.put('/accounts/:id', (req, res) => {
    const accountId = req.params.id;
    const { account_type, status } = req.body;
    db.query(
        'UPDATE account SET account_type = ?, status = ? WHERE user_id = ?',
        [account_type, status, accountId],
        (err, results) => {
        if (err) return res.status(500).json({ error: err });
        if (results.affectedRows === 0) return res.status(404).json({ msg: "Account not found" });
        res.json({ msg: "Account updated" });
        }
    );
    });


    app.put('/accounts/:id/deactivate', (req, res) => {
    const accountId = req.params.id;
    db.query('UPDATE account SET status = "deactivated" WHERE account_id = ?', [accountId], (err, results) => {
        if (err) return res.status(500).json({ error: err });
        if (results.affectedRows === 0) return res.status(404).json({ msg: "Account not found" });
        res.json({ msg: "Account deactivated" });
    });
    });


    app.put('/accounts/:id/freeze', (req, res) => {
    const accountId = req.params.id;
    const freezeDays = parseInt(req.body.days);

    if (!freezeDays || freezeDays <= 0) {
        return res.status(400).json({ msg: "Please provide a valid number of days for freezing" });
    }

    const freezeUntil = new Date();
    freezeUntil.setDate(freezeUntil.getDate() + freezeDays);

    db.query(
        'UPDATE account SET status = "frozen", freeze_until = ? WHERE account_id = ?',
        [freezeUntil, accountId],
        (err, results) => {
        if (err) return res.status(500).json({ error: err });
        if (results.affectedRows === 0) return res.status(404).json({ msg: "Account not found" });
        res.json({ msg: `Account frozen for ${freezeDays} days` });
        }
    );
    });




    app.put('/accounts/:id/unfreeze', (req, res) => {
    const accountId = req.params.id;
    db.query(
        'UPDATE account SET status = "active", freeze_until = NULL WHERE account_id = ?',
        [accountId],
        (err, results) => {
        if (err) return res.status(500).json({ error: err });
        if (results.affectedRows === 0) return res.status(404).json({ msg: "Account not found" });
        res.json({ msg: "Account unfrozen" });
        }
    );
    });


    app.post('/transfers', (req, res) => {
        const { from_user_id, to_user_id, amount, description } = req.body;
    
        if (!from_user_id || !to_user_id || !amount || amount <= 0)
            return res.status(400).json({ msg: "Invalid input" });
    
        db.query('SELECT balance FROM users WHERE id = ?', [from_user_id], (err, fromUserResult) => {
            if (err) return res.status(500).json({ error: err });
            if (fromUserResult.length === 0) return res.status(404).json({ msg: "Sender not found" });
    
            if (fromUserResult[0].balance < amount)
                return res.status(400).json({ msg: "Insufficient balance" });
    
            db.query('SELECT account_type FROM account WHERE user_id = ?', [from_user_id], (err, fromAccountResult) => {
                if (err) return res.status(500).json({ error: err });
                if (fromAccountResult.length === 0) return res.status(404).json({ msg: "Sender account not found" });
    
                if (fromAccountResult[0].account_type !== 'checking') {
                    return res.status(400).json({ msg: "Sender account type not allowed for transfer" });
                }
    
                db.query('SELECT account_type FROM account WHERE user_id = ?', [to_user_id], (err, toAccountResult) => {
                    if (err) return res.status(500).json({ error: err });
                    if (toAccountResult.length === 0) return res.status(404).json({ msg: "Receiver account not found" });
    
                    if (toAccountResult[0].account_type !== 'checking') {
                        return res.status(400).json({ msg: "Receiver account type not allowed for transfer" });
                    }
    
                    // خصم الرصيد من المرسل
                    db.query('UPDATE users SET balance = balance - ? WHERE id = ?', [amount, from_user_id], (err) => {
                        if (err) return res.status(500).json({ error: err });
    
                        // إضافة الرصيد للمستلم
                        db.query('UPDATE users SET balance = balance + ? WHERE id = ?', [amount, to_user_id], (err) => {
                            if (err) return res.status(500).json({ error: err });
    
                            // تسجيل المعاملة
                            db.query(
                                'INSERT INTO transactions (from_user_id, to_user_id, amount, status, description) VALUES (?, ?, ?, ?, ?)',
                                [from_user_id, to_user_id, amount, 'Complete', description || 'Transfer completed'],
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
    



    app.get('/transactions/:userId', (req, res) => {
    const userId = req.params.userId;
    const { type } = req.query;

    let sql = 'SELECT * FROM transactions WHERE from_user_id = ? OR to_user_id = ?';
    let params = [userId, userId];

    if (type === 'sent') {
        sql = 'SELECT * FROM transactions WHERE from_user_id = ?';
        params = [userId];
    } else if (type === 'received') {
        sql = 'SELECT * FROM transactions WHERE to_user_id = ?';
        params = [userId];
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
