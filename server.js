const express = require('express');
const session = require('express-session');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const ping = require('ping');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const multer = require('multer');





// Configuration de Multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, 'views/uploads')); // Définit le chemin absolu vers 'views/uploads'
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `${file.fieldname}-${uniqueSuffix}${path.extname(file.originalname)}`);
    }
});

const upload = multer({ storage }); // Instancie Multer

// Configuration pour EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Chemin vers la base de données JSON
const dbPath = path.join(__dirname, 'db.json');

// Middleware pour les sessions
app.use(
    session({
        secret: 'titiduti', // Changez ce secret
        resave: false,
        saveUninitialized: true,
        cookie: { secure: false },
    })
);

// Middleware pour traiter les données du formulaire
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Fonction pour lire les données de la base
function readDB() {
    const data = fs.readFileSync(dbPath, 'utf8');
    return JSON.parse(data);
}

// Fonction pour écrire les données dans la base
function writeDB(data) {
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 4), 'utf8');
}

// Middleware pour protéger les pages d'administration
function isAdmin(req, res, next) {
    if (req.session && req.session.isAdmin) {
        next();
    } else {
        res.redirect('/admin/login');
    }
}


app.use((req, res, next) => {
    try {
        const db = readDB(); // Lecture de db.json
        console.log('Favicon actuel:', db.settings?.favicon || 'Aucun favicon défini'); // Debugging
        res.locals.settings = db.settings || {}; // Passer les paramètres aux vues
    } catch (err) {
        console.error('Erreur lors de la lecture de db.json:', err.message);
        res.locals.settings = {}; // Définit une valeur par défaut
    }
    next();
});

// Routes publiques
app.get('/', (req, res) => {
    const db = readDB();
    res.render('index', { machines: db.machines, alertMessage: db.alertMessage });
});

app.get('/admin/login', (req, res) => {
    res.render('admin/login');
});

app.post('/admin/login', (req, res) => {
    const { username, password } = req.body;

    if (username === 'admin' && password === 'Tyliandu85*') {
        req.session.isAdmin = true;
        res.redirect('/admin');
    } else {
        res.render('admin/login', { error: 'Identifiants invalides.' });
    }
});

app.get('/admin/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/admin/login');
    });
});

// Page d'administration principale
app.get('/admin', isAdmin, async (req, res) => {
    const db = readDB();
    const totalMachines = db.machines.length;

    let onlineMachines = 0;
    let offlineMachines = 0;

    await Promise.all(
        db.machines.map(async (machine) => {
            const result = await ping.promise.probe(machine.ip);
            if (result.alive) {
                onlineMachines++;
            } else {
                offlineMachines++;
            }
        })
    );

    res.render('admin/admin', {
        machines: db.machines,
        tags: db.tags,
        totalMachines,
        onlineMachines,
        offlineMachines,
    });
});

// Page de gestion des machines
app.get('/admin/machines', isAdmin, (req, res) => {
    const db = readDB();
    res.render('admin/machine', { machines: db.machines, tags: db.tags });
});

// API pour les machines
app.get('/api/machines', isAdmin, (req, res) => {
    const db = readDB();
    res.json(db.machines);
});

app.post('/api/machines', isAdmin, (req, res) => {
    const db = readDB();
    const newMachine = {
        id: db.machines.length > 0 ? db.machines[db.machines.length - 1].id + 1 : 1,
        name: req.body.name,
        ip: req.body.ip,
        category: req.body.category,
        tags: req.body.tags || [],
    };
    db.machines.push(newMachine);
    writeDB(db);
    res.json({ message: 'Machine ajoutée avec succès', machine: newMachine });
});

app.put('/api/machines/:id', isAdmin, (req, res) => {
    const db = readDB();
    const machineId = parseInt(req.params.id);

    const machine = db.machines.find((m) => m.id === machineId);
    if (!machine) {
        return res.status(404).json({ message: 'Machine non trouvée' });
    }

    machine.name = req.body.name || machine.name;
    machine.ip = req.body.ip || machine.ip;
    machine.category = req.body.category || machine.category;
    machine.tags = req.body.tags || machine.tags;

    writeDB(db);
    res.json({ message: `Machine ${machineId} modifiée avec succès`, machine });
});

app.delete('/api/machines/:id', isAdmin, (req, res) => {
    const db = readDB();
    const machineId = parseInt(req.params.id);
    const machineIndex = db.machines.findIndex((m) => m.id === machineId);

    if (machineIndex === -1) {
        return res.status(404).json({ message: 'Machine non trouvée' });
    }

    db.machines.splice(machineIndex, 1);
    writeDB(db);
    res.json({ message: `Machine ${machineId} supprimée avec succès` });
});

// Fonction ping
function pingMachine(ip, callback) {
    ping.promise.probe(ip)
        .then((res) => {
            callback({ status: res.alive ? 'OK' : 'DOWN', responseTime: res.time || 'N/A' });
        })
        .catch((err) => {
            console.error(`Ping error for ${ip}:`, err.message);
            callback({ status: 'DOWN', responseTime: 'N/A' });
        });
}

// WebSocket pour les mises à jour en temps réel
io.on('connection', (socket) => {
    console.log('Client connecté');

    setInterval(() => {
        const db = readDB();
        db.machines.forEach((machine) => {
            pingMachine(machine.ip, (result) => {
                socket.emit('machine-status', {
                    name: machine.name,
                    category: machine.category,
                    tags: machine.tags,
                    ...result,
                });
            });
        });

        socket.emit('alert', db.alertMessage);
    }, 5000);
});

app.get('/admin/categories', isAdmin, (req, res) => {
    const db = readDB();
    res.render('admin/categories', { categories: db.categories });
});


// API pour les catégories
app.get('/api/categories', isAdmin, (req, res) => {
    const db = readDB();
    res.json(db.categories || []);
});

app.post('/api/categories', isAdmin, (req, res) => {
    const db = readDB();
    const newCategory = {
        id: db.categories.length > 0 ? db.categories[db.categories.length - 1].id + 1 : 1,
        name: req.body.name,
    };

    db.categories.push(newCategory);
    writeDB(db);
    res.json({ message: 'Catégorie ajoutée avec succès', category: newCategory });
});

app.put('/api/categories/:id', isAdmin, (req, res) => {
    const db = readDB();
    const categoryId = parseInt(req.params.id);

    const category = db.categories.find(c => c.id === categoryId);
    if (!category) {
        return res.status(404).json({ message: 'Catégorie non trouvée' });
    }

    category.name = req.body.name || category.name;
    writeDB(db);
    res.json({ message: `Catégorie ${categoryId} modifiée avec succès`, category });
});

app.delete('/api/categories/:id', isAdmin, (req, res) => {
    const db = readDB();
    const categoryId = parseInt(req.params.id);

    db.categories = db.categories.filter(c => c.id !== categoryId);
    writeDB(db);
    res.json({ message: `Catégorie ${categoryId} supprimée avec succès` });
});

app.get('/api/alert', isAdmin, (req, res) => {
    const db = readDB();
    res.json({ alertMessage: db.alertMessage || "" });
});

app.put('/api/alert', isAdmin, (req, res) => {
    const db = readDB();

    if (!req.body.alertMessage) {
        return res.status(400).json({ message: "Le message d'alerte ne peut pas être vide." });
    }

    db.alertMessage = req.body.alertMessage;
    writeDB(db);

    res.json({ message: "Message d'alerte mis à jour avec succès." });
});

app.get('/admin/alertes', isAdmin, (req, res) => {
    const db = readDB();
    res.render('admin/alertes', { alertMessage: db.alertMessage || "" });
});

app.get('/admin/parametres', isAdmin, (req, res) => {
    const db = readDB();
    res.render('admin/parametres', { settings: db.settings || {} });
});

// Route pour gérer la mise à jour des paramètres
app.post('/admin/parametres', upload.fields([{ name: 'logo' }, { name: 'favicon' }]), (req, res) => {
    const db = readDB();

    // Mise à jour des paramètres
    db.settings.siteTitle = req.body.siteTitle;
    db.settings.siteDescription = req.body.siteDescription;
    db.settings.displayDescription = req.body.displayDescription === 'true' || req.body.displayDescription === 'on';
    db.settings.backgroundColor = req.body.backgroundColor || '#ccc9c9';
    db.settings.primaryColor = req.body.primaryColor || '#ec7d7a';
    db.settings.secondaryColor = req.body.secondaryColor || '#e74c3c';

    // Gestion des fichiers
    if (req.files.logo) {
        const logoFile = req.files.logo[0];
        db.settings.logo = `/uploads/${logoFile.filename}`;
    }

    if (req.files.favicon) {
        const faviconFile = req.files.favicon[0];
        db.settings.favicon = `/uploads/${faviconFile.filename}`;
    }

    writeDB(db); // Sauvegarde dans db.json
    res.redirect('/admin/parametres');
});


app.use('/uploads', express.static(path.join(__dirname, 'views/uploads')));

const uploadsDir = path.join(__dirname, 'views/uploads');

// Vérifie si le dossier 'uploads' existe, sinon le crée
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

app.get('/favicon.ico', (req, res) => {
    const db = readDB(); // Charge les paramètres depuis db.json
    if (db.settings.favicon) {
        res.sendFile(path.join(__dirname, db.settings.favicon));
    } else {
        res.status(404).send('Favicon non trouvé.');
    }
});

app.use((req, res, next) => {
    const db = readDB();
    console.log('Favicon chargé depuis db.json :', db.settings.favicon); // Debugging
    res.locals.settings = db.settings;
    next();
});





// Lancer le serveur
const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Serveur démarré sur http://localhost:${PORT}`);
});
