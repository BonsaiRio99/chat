const net = require('net');
const readline = require('readline');

const host = process.argv[2];
const port = process.argv[3];

if (!host || !port) {
    console.error('Használat: node client.js <host> <port>');
    process.exit(1);
}

const socket = net.createConnection(port, host, () => {
    console.log('Csatlakozva a szerverhez.');
});

socket.setEncoding('utf8');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: ''
});

let state = 'username';
let username = '';
let loggedIn = false;

socket.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (let line of lines) {
        if (line === '') continue;
        if (!loggedIn) {
            process.stdout.write(line + '\n');

            if (line.startsWith('Kérem a jelszót!:')) {
                state = 'password';
            } else if (line.startsWith('Üdvözlünk,')) {
                loggedIn = true;
                state = 'chat';
            }
        } else {
            console.log(line);
        }
    }
});

rl.on('line', (input) => {
    if (!loggedIn) {
        if (state === 'username') {
            username = input; 
        }
        socket.write(input + '\n');
    } else {
        if (input.trim() === '/quit') {
            socket.end();
            process.exit();
        } else {
            socket.write(input + '\n');
            const formatted = input.replace(/:-\)/g, '😊')
                                    .replace(/:-D/g, '😃')
                                    .replace(/:-P/g, '😛')
                                    .replace(/:-\(/g, '😞')
                                    .replace(/:3/g, '😊')
                                    .replace(/<3/g, '❤️');
            console.log(`<${username}> ${formatted}`);
        }
    }
});

socket.on('end', () => {
    console.log('Kapcsolat bontva.');
    process.exit();
});

socket.on('error', (err) => {
    console.error('Hiba:', err.message);
    process.exit(1);
});
