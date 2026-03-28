const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static(__dirname));

let roomData = {}; // La mémoire du serveur pour retenir les maps

io.on('connection', (socket) => {
    console.log('🟢 Un joueur est connecté ! ID:', socket.id);

    socket.on('joinRoom', (roomCode) => {
        socket.join(roomCode);
        
        // 1. On compte les joueurs pour attribuer les numéros (Joueur 1, puis Joueur 2...)
        if (!roomData[roomCode]) roomData[roomCode] = { playerCount: 0, grid: null };
        roomData[roomCode].playerCount++;
        
        const playerNum = roomData[roomCode].playerCount;
        console.log(`🏠 Joueur ${playerNum} a rejoint la salle ${roomCode}`);

        // 2. On dit au jeu de démarrer avec son numéro, et on lui donne la map si elle existe déjà
        socket.emit('gameStarted', { 
            playerNum: playerNum, 
            grid: roomData[roomCode].grid 
        });
    });

    // 3. Quand le Joueur 1 crée la map, il l'envoie au serveur pour la sauvegarder
    socket.on('saveMap', (data) => {
        roomData[data.room].grid = data.grid;
        // On la transmet aux autres joueurs du salon
        socket.to(data.room).emit('loadMap', data.grid);
    });

    // 4. Quand un joueur fait un coup valide, on l'envoie à tout le monde
    socket.on('playTurn', (data) => {
        io.to(data.room).emit('updateBoard', data);
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`🚀 Serveur activé sur le port ${PORT}`);
});