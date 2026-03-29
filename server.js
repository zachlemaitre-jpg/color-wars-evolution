const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static(__dirname));

let rooms = {};

io.on('connection', (socket) => {
    console.log('🟢 Connexion:', socket.id);

    socket.on('joinRoom', (data) => {
        // Rétrocompatibilité au cas où (si data est une simple string)
        let roomCode = typeof data === 'string' ? data : data.roomCode;
        let pseudo = typeof data === 'string' ? 'Invité' : data.pseudo;

        socket.join(roomCode);
        
        if (!rooms[roomCode]) {
            rooms[roomCode] = {
                clients: [], 
                settings: { playerCount: 3, gridSize: 'normal', biome: 'classic', toggles: {} }, 
                grid: null,
                isPlaying: false,
                lastActivity: Date.now()
            };
        }
        
        const room = rooms[roomCode];
        // On vérifie si l'id n'est pas déjà dans la liste (reconnexion)
        if (!room.clients.find(c => c.id === socket.id)) {
            room.clients.push({ id: socket.id, pseudo: pseudo });
        }

        const isHost = room.clients[0].id === socket.id;
        
        socket.emit('lobbyJoined', {
            roomCode: roomCode,
            isHost: isHost,
            settings: room.settings
        });

        // 📡 DIFFUSION : Nouveau joueur dans la salle
        io.to(roomCode).emit('playersUpdated', room.clients);

        // --- Gestion des retardataires ---
        // Si la partie est DÉJÀ en cours, on force l'invité en Spectateur instantanément
        // plutôt que de le laisser bloqué sur l'écran du lobby indéfiniment.
        if (room.isPlaying && !isHost) {
            socket.emit('gameStarted', { playerNum: 'spectator', settings: room.settings });
            // Envoi de l'état complet (grille + tour + stocks...) pour un affichage immédiatement correct
            if (room.lastGameState) {
                socket.emit('loadMap', room.lastGameState);
            }
        }
    });

    socket.on('createRoom', (data) => {
        let newRoomCode;
        let pseudo = data && data.pseudo ? data.pseudo : 'Hôte';
        
        while (rooms[newRoomCode = Math.random().toString(36).substring(2, 8).toUpperCase()]);

        rooms[newRoomCode] = {
            clients: [{ id: socket.id, pseudo: pseudo }],
            settings: { playerCount: 3, gridSize: 'normal', biome: 'classic', toggles: {} },
            grid: null,
            isPlaying: false,
            lastActivity: Date.now()
        };

        socket.join(newRoomCode);
        socket.emit('lobbyJoined', {
            roomCode: newRoomCode,
            isHost: true,
            settings: rooms[newRoomCode].settings
        });

        io.to(newRoomCode).emit('playersUpdated', rooms[newRoomCode].clients);
    });

    socket.on('updateSettings', (data) => {
        const room = rooms[data.roomCode];
        if (room && room.clients[0].id === socket.id) {
            room.lastActivity = Date.now(); // TTL refresh
            room.settings = data.settings;
            socket.to(data.roomCode).emit('settingsChanged', room.settings);
            
            // On renvoie la liste des joueurs car le changement de playerCount 
            // modifie le statut "Joueur/Spectateur" dans l'UI du lobby
            io.to(data.roomCode).emit('playersUpdated', room.clients);
        }
    });

    socket.on('requestStartGame', (data) => {
        const room = rooms[data.roomCode];
        if (room && room.clients[0].id === socket.id) { // VÉRIF MIGRÉE
            room.isPlaying = true;
            
            room.clients.forEach((client, index) => {
                let role = 'spectator';
                if (index < room.settings.playerCount) {
                    role = index + 1; 
                }
                io.to(client.id).emit('gameStarted', { playerNum: role, settings: room.settings });
            });
        }
    });

    socket.on('saveMap', (data) => {
        const room = rooms[data.room];
        // SÉCURITÉ : Seul l'hôte (clients[0]) a le droit d'imposer l'état absolu du jeu
        if (room && room.clients[0].id === socket.id) {
            room.grid = data.grid;
            room.lastGameState = data; // Sauvegarde l'état complet pour les retardataires
            room.lastActivity = Date.now(); // TTL refresh
            socket.to(data.room).emit('loadMap', data); 
        } else {
            console.warn(`⚠️ Tentative de triche bloquée : Le socket ${socket.id} a tenté de forcer une synchronisation globale.`);
        }
    });

    socket.on('playTurn', (data) => {
        const room = rooms[data.room];
        if (!room) return;
        room.lastActivity = Date.now(); // TTL refresh

        // V1.2 — Vérification d'identité : seul le joueur concerné (ou l'Hôte
        // qui valide le coup d'un invité) peut émettre ce message.
        const senderIndex = room.clients.findIndex(c => c.id === socket.id);
        if (senderIndex === -1) return; // L'émetteur n'est pas dans la room

        const isRoomHost = senderIndex === 0;
        const senderPlayerNum = senderIndex + 1; // 1-indexé, aligné sur playerCount

        // Strict : Personne ne peut jouer pour quelqu'un d'autre, même l'Hôte.
        if (senderPlayerNum !== Number(data.player)) {
            console.warn(`⚠️  Tentative de triche bloquée : socket ${socket.id} a tenté de jouer pour le joueur ${data.player}`);
            return;
        }

        io.to(data.room).emit('updateBoard', data);
    });
    
    socket.on('teleportEvent', (data) => {
        // data = { room, tr, tc, owner, dtype, dr, dc }
        socket.to(data.room).emit('executeTeleport', data);
    });

    socket.on('requestFusion', (data) => {
        // On vérifie que l'émetteur est bien dans la room avant de relayer
        const room = rooms[data.room];
        if (room && room.clients.find(c => c.id === socket.id)) {
            room.lastActivity = Date.now();
            io.to(data.room).emit('fusionExecuted', data);
        }
    });

    socket.on('sendChat', (data) => {
        io.to(data.room).emit('chatMessage', {
            sender: data.sender,
            text: data.text,
            pseudo: data.pseudo // Vient d'être ajouté côté client
        });
    });

    socket.on('requestReturnToLobby', (roomCode) => {
        const room = rooms[roomCode];
        if (room && room.clients[0].id === socket.id) { // VÉRIF MIGRÉE
            room.isPlaying = false;
            io.to(roomCode).emit('returnToLobby');
        }
    });

    socket.on('disconnect', () => {
        for (const roomCode in rooms) {
            const room = rooms[roomCode];
            // Recherche de l'index via la propriété id
            const index = room.clients.findIndex(c => c.id === socket.id); 
            if (index !== -1) {
                room.clients.splice(index, 1);
                if (room.clients.length === 0) {
                    delete rooms[roomCode]; 
                } else {
                    if (index === 0) {
                        io.to(room.clients[0].id).emit('hostMigrated');
                    }
                    // 📡 DIFFUSION : Un joueur a quitté
                    io.to(roomCode).emit('playersUpdated', room.clients);
                }
            }
        }
    });
});

// ─── Garbage Collector ────────────────────────────────────────────────────────
// Toutes les 10 minutes, on supprime les salons vides ou inactifs depuis 1h.
// Couvre les cas de déconnexion brutale que le handler 'disconnect' ne détecte pas.
const ONE_HOUR_MS = 3_600_000;
setInterval(() => {
    let deleted = 0;
    const now = Date.now();
    for (const roomCode in rooms) {
        const room = rooms[roomCode];
        const isEmpty = room.clients.length === 0;
        const isStale = room.lastActivity && (now - room.lastActivity > ONE_HOUR_MS);
        if (isEmpty || isStale) {
            delete rooms[roomCode];
            deleted++;
        }
    }
    if (deleted > 0) console.log(`🧹 GC : ${deleted} salon(s) supprimé(s).`);
}, 600_000);

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`🚀 Serveur activé sur le port ${PORT}`);
});