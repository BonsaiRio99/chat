const tls = require('tls');
const readline = require('readline');

const host = process.argv[2];
const port = process.argv[3];

if (!host || !port) {
    console.error('Használat: node client.js <host> <port>');
    process.exit(1);
}

const socket = tls.connect(port, host, { rejectUnauthorized: false }, () => {
    console.log('Csatlakozva a szerverhez (TLS).');
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

        if (line.startsWith('PROMPT_USERNAME')) {
            state = 'username';
            process.stdout.write('Felhasználónév: ');
        } else if (line.startsWith('PROMPT_PASSWORD')) {
            state = 'password';
            process.stdout.write('Jelszó: ');
        } else if (line.startsWith('INFO ')) {
            console.log(line.substring(5));
            if (line.includes('Üdvözlünk,')) loggedIn = true;
        } else if (line.startsWith('HIST ')) {
            console.log(line.substring(5));
        } else if (line.startsWith('MSG ')) {
            console.log(line.substring(4));
        } else if (line.startsWith('JOIN ')) {
            console.log(line.substring(5));
        } else if (line.startsWith('PART ')) {
            console.log(line.substring(5));
        } else if (line.startsWith('ERROR ')) {
            console.error('Hiba:', line.substring(6));
            if (line.includes('Ki lettél')) socket.end();
        } else {
            console.log(line);
        }
    }
});

rl.on('line', (input) => {
    if (!loggedIn) {
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
