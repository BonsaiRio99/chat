const tls = require('tls');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

const host = 'ca-01.rrhosting.eu';
const port = 7984;
const CLIENT_SECRET = 'dhduewhfuii4378fgu3gw478ftgq348tfgu7q348tgfu7w3t4';

let socket;
let rl;
let state = 'mode';
let username = '';
let loggedIn = false;
let fileMode = false;
let fileDownload = null;
let expectingFileData = false;
let chatBuffer = [];
const MAX_BUFFER = 200;
let uploadInProgress = false;
let currentLine = '';

function getDownloadsFolder() {
    const home = process.env.HOME || process.env.USERPROFILE;
    if (!home) return path.join(__dirname, 'downloads');
    const downloads = path.join(home, 'Downloads');
    return fs.existsSync(downloads) ? downloads : home;
}

function clearScreen() {
    process.stdout.write('\x1bc');
}

function addToChatBuffer(line) {
    chatBuffer.push(line);
    if (chatBuffer.length > MAX_BUFFER) chatBuffer.shift();
}

function displayChatBuffer() {
    chatBuffer.forEach(line => console.log(line));
}

function writeMessage(text) {
    if (!text) return;
    if (rl) {
        readline.cursorTo(process.stdout, 0);
        readline.clearLine(process.stdout, 1);
        console.log(text);
        rl.prompt(true);
        if (currentLine) {
            process.stdout.write(currentLine);
        }
    } else {
        console.log(text);
    }
}

function createSocket() {
    socket = tls.connect(port, host, { rejectUnauthorized: false }, () => {
        socket.write(CLIENT_SECRET + '\n');
    });
    socket.setEncoding('utf8');

    socket.on('data', (data) => {
        const lines = data.toString().split('\n');
        for (let line of lines) {
            if (line === '') continue;

            if (expectingFileData) {
                if (fileDownload) {
                    fileDownload.data += line;
                    fileDownload.received += line.length;
                }
                expectingFileData = false;
                continue;
            }

            if (line.startsWith('FILE_MODE_ENTER')) {
                fileMode = true;
                clearScreen();
                rl.setPrompt('files> ');
                rl.prompt();
                continue;
            } else if (line.startsWith('FILE_MODE_EXIT')) {
                fileMode = false;
                clearScreen();
                displayChatBuffer();
                rl.setPrompt('');
                rl.prompt();
                continue;
            } else if (line.startsWith('FILE_MODE ')) {
                writeMessage(line.substring(10));
                continue;
            } else if (line.startsWith('FILE_ENTRY ')) {
                const parts = line.substring(11).split(' ');
                const name = parts[0], type = parts[1], size = parts[2] ? parseInt(parts[2]) : 0;
                if (type === 'dir') writeMessage(`  ${name}/`);
                else {
                    const sizeStr = size < 1024 ? `${size} B` : size < 1048576 ? `${(size/1024).toFixed(1)} KB` : `${(size/1048576).toFixed(1)} MB`;
                    writeMessage(`  ${name} (${sizeStr})`);
                }
                continue;
            } else if (line.startsWith('FILE_START ')) {
                const parts = line.substring(11).split(' ');
                fileDownload = { filename: parts[0], data: '', size: parseInt(parts[1]), received: 0 };
                writeMessage(`Letöltés: ${parts[0]} (${parts[1]} byte base64)...`);
                continue;
            } else if (line === 'FILE_DATA') {
                expectingFileData = true;
                continue;
            } else if (line === 'FILE_END') {
                if (fileDownload) {
                    const buffer = Buffer.from(fileDownload.data, 'base64');
                    const savePath = path.join(getDownloadsFolder(), fileDownload.filename);
                    fs.writeFile(savePath, buffer, (err) => {
                        if (err) writeMessage(`Hiba a fájl mentésekor: ${err.message}`);
                        else writeMessage(`Fájl elmentve: ${savePath}`);
                        fileDownload = null;
                    });
                }
                continue;
            } else if (line.startsWith('FILE_ERROR ')) {
                writeMessage(`Hiba: ${line.substring(11)}`);
                continue;
            }

            if (!fileMode) {
                if (line.startsWith('PROMPT_MODE')) {
                    socket.write('chat\n');
                } else if (line.startsWith('PROMPT_USERNAME')) {
                    state = 'username';
                    process.stdout.write('Felhasználónév: ');
                } else if (line.startsWith('PROMPT_PASSWORD')) {
                    state = 'password';
                    process.stdout.write('Jelszó: ');
                } else if (line.startsWith('INFO ')) {
                    const msg = line.substring(5);
                    writeMessage(msg);
                    addToChatBuffer(msg);
                    if (line.includes('Welcome,')) {
                        loggedIn = true;
                        state = 'chat';
                        rl.setPrompt('');
                        rl.prompt();
                    }
                } else if (line.startsWith('HIST ')) {
                    const msg = line.substring(5);
                    writeMessage(msg);
                    addToChatBuffer(msg);
                } else if (line.startsWith('MSG ')) {
                    const msg = line.substring(4);
                    writeMessage(msg);
                    addToChatBuffer(msg);
                } else if (line.startsWith('JOIN ') || line.startsWith('PART ')) {
                    const msg = line.substring(5);
                    writeMessage(msg);
                    addToChatBuffer(msg);
                } else if (line.startsWith('ERROR ')) {
                    const msg = 'Error: ' + line.substring(6);
                    writeMessage(msg);
                    addToChatBuffer(msg);
                    if (line.includes('Update required')) {
                        process.exit(1);
                    }
                    if (line.includes('banned') || line.includes('kicked') || line.includes('shutting down') || line.includes('closed')) {
                        socket.end();
                    }
                } else {
                    writeMessage(line);
                    addToChatBuffer(line);
                }
            } else {
                if (line.startsWith('INFO ') || line.startsWith('MSG ') || line.startsWith('JOIN ') || line.startsWith('PART ') || line.startsWith('ERROR ') || line.startsWith('HIST ')) {
                    let content = line;
                    if (line.startsWith('INFO ')) content = line.substring(5);
                    else if (line.startsWith('MSG ')) content = line.substring(4);
                    else if (line.startsWith('JOIN ') || line.startsWith('PART ')) content = line.substring(5);
                    else if (line.startsWith('ERROR ')) content = 'Error: ' + line.substring(6);
                    else if (line.startsWith('HIST ')) content = line.substring(5);
                    addToChatBuffer(content);
                }
            }
        }
        if (fileMode && !uploadInProgress) {
            rl.prompt();
        } else if (!fileMode && loggedIn && state === 'chat') {
            rl.prompt();
        }
    });

    socket.on('end', () => {
        writeMessage('Kapcsolat bontva.');
        process.exit();
    });

    socket.on('error', (err) => {
        writeMessage(`Hiba: ${err.message}`);
        process.exit(1);
    });
}

rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '',
    terminal: true
});

rl.input.on('data', (chunk) => {
    const str = chunk.toString();
    if (str === '\r' || str === '\n') {
        currentLine = '';
    } else if (str === '\x7f' || str === '\b') {
        currentLine = currentLine.slice(0, -1);
    } else if (str >= ' ') {
        currentLine += str;
    }
});

rl.on('line', (input) => {
    if (uploadInProgress) {
        writeMessage('Feltöltés folyamatban, várj...');
        return;
    }

    if (!loggedIn) {
        if (state === 'mode') {
            socket.write(input + '\n');
        } else if (state === 'username') {
            username = input;
            socket.write(input + '\n');
        } else if (state === 'password') {
            socket.write(input + '\n');
        }
    } else if (fileMode) {
        if (input.trim() === '/back') {
            socket.write('/back\n');
        } else if (input.trim() === '/quit') {
            socket.write('/quit\n');
        } else {
            socket.write(input + '\n');
        }
    } else {
        if (input.trim() === '/quit') {
            socket.end();
        } else if (input.trim() === '/files') {
            socket.write('/files\n');
        } else {
            if (input.trim() === '') {
                rl.prompt();
                return;
            }
            socket.write(input + '\n');
            const formatted = input.replace(/:-\)/g, '😊').replace(/:-D/g, '😃').replace(/:-P/g, '😛').replace(/:-\(/g, '😞').replace(/:3/g, '😊').replace(/<3/g, '❤️');
            writeMessage(`<${username}> ${formatted}`);
            addToChatBuffer(`<${username}> ${formatted}`);
        }
    }
});

createSocket();

process.on('SIGINT', () => {
    socket.end();
    process.exit();
});
