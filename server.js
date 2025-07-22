// server.js (Para ejecutar en tu instancia EC2)
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
    origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// Configuración del juego
const ROWS = 6;
const COLS = 7;
const WIN_CONDITION = 4; // Cuatro en línea

let waitingPlayers = []; // Lista de sockets esperando un oponente
let activeGames = {};    // Objeto para almacenar los estados de los juegos activos
                         // Key: gameId, Value: { board, players: {1: socketId, 2: socketId}, turn: 1|2 }

// Función para crear un nuevo tablero vacío
function createBoard() {
    return Array(ROWS).fill(null).map(() => Array(COLS).fill(0));
}

// Función para verificar si un movimiento es válido
function isValidMove(board, col) {
    if (col < 0 || col >= COLS) return false;
    // Verificar si la columna no está llena (la fila 0 es la superior)
    return board[0][col] === 0;
}

// Función para realizar un movimiento en el tablero
function makeMove(board, col, player) {
    for (let r = ROWS - 1; r >= 0; r--) {
        if (board[r][col] === 0) {
            board[r][col] = player;
            return { row: r, col: col }; // Retorna la posición donde se colocó la ficha
        }
    }
    return null; // Columna llena
}

// Función para verificar si hay un ganador
function checkWin(board, player, lastMove) {
    if (!lastMove) return false; // No hay un último movimiento para verificar

    const { row, col } = lastMove;

    // Direcciones para verificar (horizontal, vertical, diagonales)
    const directions = [
        [0, 1],   // Horizontal
        [1, 0],   // Vertical
        [1, 1],   // Diagonal \
        [1, -1]   // Diagonal /
    ];

    for (const [dr, dc] of directions) {
        let count = 1; // Contar la ficha actual
        // Verificar en una dirección
        for (let i = 1; i < WIN_CONDITION; i++) {
            const r = row + dr * i;
            const c = col + dc * i;
            if (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r][c] === player) {
                count++;
            } else {
                break;
            }
        }
        // Verificar en la dirección opuesta
        for (let i = 1; i < WIN_CONDITION; i++) {
            const r = row - dr * i;
            const c = col - dc * i;
            if (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r][c] === player) {
                count++;
            } else {
                break;
            }
        }
        if (count >= WIN_CONDITION) {
            return true;
        }
    }
    return false;
}

// Función para verificar si el tablero está lleno (empate)
function isBoardFull(board) {
    return board[0].every(cell => cell !== 0);
}

// Manejo de conexiones de Socket.IO
io.on('connection', (socket) => {
    console.log(`Usuario conectado: ${socket.id}`);

    // Intentar emparejar al nuevo jugador
    if (waitingPlayers.length > 0) {
        const opponentSocket = waitingPlayers.shift(); // Tomar el primer jugador en espera
        const gameId = socket.id + '-' + opponentSocket.id; // Generar un ID de juego único

        // Crear un nuevo juego
        activeGames[gameId] = {
            board: createBoard(),
            players: {
                1: opponentSocket.id, // Jugador 1
                2: socket.id          // Jugador 2
            },
            turn: 1, // El Jugador 1 comienza
            lastMove: null // Almacenar el último movimiento para la verificación de victoria
        };

        // Asociar el gameId a ambos sockets para fácil referencia
        socket.gameId = gameId;
        opponentSocket.gameId = gameId;

        // Notificar a ambos jugadores que el juego ha comenzado
        io.to(opponentSocket.id).emit('game_start', {
            playerNumber: 1,
            startingPlayer: 1,
            board: activeGames[gameId].board
        });
        io.to(socket.id).emit('game_start', {
            playerNumber: 2,
            startingPlayer: 1,
            board: activeGames[gameId].board
        });

        console.log(`Juego iniciado entre ${opponentSocket.id} (P1) y ${socket.id} (P2). ID: ${gameId}`);

    } else {
        waitingPlayers.push(socket); // Añadir el jugador a la lista de espera
        console.log(`Jugador ${socket.id} añadido a la cola de espera.`);
    }

    // Manejar el evento 'make_move'
    socket.on('make_move', (data) => {
        try {
            const gameId = socket.gameId;
            const game = activeGames[gameId];

            if (!game) {
                socket.emit('invalid_move', 'No estás en un juego activo.');
                return;
            }

            const { col, player } = data;

            // Verificar que sea el turno del jugador que envía el movimiento
            if (game.turn !== player) {
                socket.emit('invalid_move', 'No es tu turno.');
                return;
            }

            // Verificar que el jugador que envía el movimiento sea el correcto para su número
            if ((player === 1 && socket.id !== game.players[1]) || (player === 2 && socket.id !== game.players[2])) {
                socket.emit('invalid_move', 'No eres el jugador correcto para este turno.');
                return;
            }

            // Validar el movimiento
            if (!isValidMove(game.board, col)) {
                socket.emit('invalid_move', 'Columna llena o inválida.');
                return;
            }

            // Realizar el movimiento
            const moveResult = makeMove(game.board, col, player);
            game.lastMove = moveResult; // Almacenar el último movimiento

            // Verificar si hay un ganador
            if (checkWin(game.board, player, game.lastMove)) {
                console.log(`Jugador ${player} ganó el juego ${gameId}`);
                io.to(game.players[1]).emit('game_over', { board: game.board, winner: player });
                io.to(game.players[2]).emit('game_over', { board: game.board, winner: player });
                // El juego se eliminará cuando un jugador se desconecte (recargue la página)
            } else if (isBoardFull(game.board)) {
                console.log(`Juego ${gameId} terminó en empate.`);
                io.to(game.players[1]).emit('game_over', { board: game.board, winner: null }); // Empate
                io.to(game.players[2]).emit('game_over', { board: game.board, winner: null }); // Empate
                // El juego se eliminará cuando un jugador se desconecte (recargue la página)
            } else {
                // Cambiar el turno
                game.turn = (player === 1) ? 2 : 1;
                // Notificar a ambos jugadores sobre el movimiento
                io.to(game.players[1]).emit('move_made', { board: game.board, nextPlayer: game.turn });
                io.to(game.players[2]).emit('move_made', { board: game.board, nextPlayer: game.turn });
            }
        } catch (error) {
            console.error(`Error en make_move para socket ${socket.id}:`, error);
            socket.emit('server_error', 'Ocurrió un error en el servidor al realizar el movimiento.');
        }
    });


    // Manejar la desconexión del usuario
    socket.on('disconnect', () => {
        console.log(`Usuario desconectado: ${socket.id}`);

        // Si el jugador estaba en la cola de espera, removerlo
        waitingPlayers = waitingPlayers.filter(s => s.id !== socket.id);

        // Si el jugador estaba en un juego activo (o terminado), notificar al oponente y eliminar el juego
        const gameId = socket.gameId;
        if (gameId && activeGames[gameId]) {
            const game = activeGames[gameId];
            const opponentSocketId = (socket.id === game.players[1]) ? game.players[2] : game.players[1];

            if (opponentSocketId) {
                // Notificar al oponente que su compañero se desconectó
                io.to(opponentSocketId).emit('opponent_disconnected');
                console.log(`Oponente ${socket.id} desconectado en el juego ${gameId}. Notificando a ${opponentSocketId}.`);
            }
            // Ahora sí eliminamos el juego solo cuando un jugador se desconecta
            delete activeGames[gameId];
            console.log(`Juego ${gameId} eliminado debido a desconexión.`);
        }
    });
});

server.listen(PORT, () => {
    console.log(`Servidor de Cuatro en Línea escuchando en el puerto ${PORT}`);
});
