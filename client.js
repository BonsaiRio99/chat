const tls = require('tls');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

const host = 'ca-01.rrhosting.eu';
const port = 7984;
const CLIENT_SECRET = 'virágfül';

let socket, rl;
let state = 'mode';
let username = '';
let loggedIn = false;
let fileMode = false;
let fileDownload = null;
let expectingFileData = false;
let chatBuffer = [];
const MAX_BUFFER = 200;
let uploadInProgress = false;

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
                console.log(line.substring(10));
                if (fileMode) rl.prompt();
                continue;
            } else if (line.startsWith('FILE_ENTRY ')) {
                const parts = line.substring(11).split(' ');
                const name = parts[0], type = parts[1], size = parts[2] ? parseInt(parts[2]) : 0;
                if (type === 'dir') console.log(`  ${name}/`);
                else {
                    const sizeStr = size < 1024 ? `${size} B` : size < 1048576 ? `${(size/1024).toFixed(1)} KB` : `${(size/1048576).toFixed(1)} MB`;
                    console.log(`  ${name} (${sizeStr})`);
                }
                if (fileMode) rl.prompt();
                continue;
            } else if (line.startsWith('FILE_START ')) {
                const parts = line.substring(11).split(' ');
                fileDownload = { filename: parts[0], data: '', size: parseInt(parts[1]), received: 0 };
                console.log(`Letöltés: ${parts[0]} (${parts[1]} byte base64)...`);
                continue;
            } else if (line === 'FILE_DATA') {
                expectingFileData = true;
                continue;
            } else if (line === 'FILE_END') {
                if (fileDownload) {
                    const buffer = Buffer.from(fileDownload.data, 'base64');
                    const savePath = path.join(getDownloadsFolder(), fileDownload.filename);
                    fs.writeFile(savePath, buffer, (err) => {
                        if (err) console.error('Hiba a fájl mentésekor:', err.message);
                        else console.log(`Fájl elmentve: ${savePath}`);
                        fileDownload = null;
                        if (fileMode) rl.prompt();
                    });
                }
                continue;
            } else if (line.startsWith('FILE_ERROR ')) {
                console.error('Hiba:', line.substring(11));
                if (fileMode) rl.prompt();
                continue;
            } else if (line.startsWith('FILEUPLOAD_REQUEST ')) {
                const targetFilename = line.substring(19);
                if (uploadInProgress) {
                    console.log(`Feltöltés megkezdve: ${targetFilename}`);
                }
                continue;
            } else if (line.startsWith('FILEUPLOAD_SUCCESS')) {
                console.log('Feltöltés sikeres.');
                uploadInProgress = false;
                if (fileMode) rl.prompt();
                continue;
            } else if (line.startsWith('FILEUPLOAD_ERROR ')) {
                console.error('Feltöltési hiba:', line.substring(17));
                uploadInProgress = false;
                if (fileMode) rl.prompt();
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
                    console.log(line.substring(5));
                    addToChatBuffer(line.substring(5));
                    if (line.includes('Welcome,')) {
                        loggedIn = true;
                        state = 'chat';
                        rl.setPrompt('');
                        rl.prompt();
                    }
                } else if (line.startsWith('HIST ')) {
                    console.log(line.substring(5));
                    addToChatBuffer(line.substring(5));
                } else if (line.startsWith('MSG ')) {
                    console.log(line.substring(4));
                    addToChatBuffer(line.substring(4));
                } else if (line.startsWith('JOIN ') || line.startsWith('PART ')) {
                    console.log(line.substring(5));
                    addToChatBuffer(line.substring(5));
                } else if (line.startsWith('ERROR ')) {
                    console.error('Error:', line.substring(6));
                    addToChatBuffer('Error: ' + line.substring(6));
                    if (line.includes('Update required')) {
                        console.log('Frissítés szükséges.');
                        process.exit(1);
                    }
                    if (line.includes('banned') || line.includes('kicked') || line.includes('shutting down') || line.includes('closed')) {
                        socket.end();
                    }
                } else {
                    console.log(line);
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
        console.log('Kapcsolat bontva.');
        process.exit();
    });

    socket.on('error', (err) => {
        console.error('Hiba:', err.message);
        process.exit(1);
    });
}

rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '' });
rl.on('line', (input) => {
    if (uploadInProgress) {
        console.log('Feltöltés folyamatban, várj...');
        return;
    }

    if (!loggedIn) {
        if (state === 'mode' || state === 'username' || state === 'password') {
            socket.write(input + '\n');
        }
    } else if (fileMode) {
        if (input.trim() === '/back') {
            socket.write('/back\n');
        } else if (input.trim() === '/quit') {
            socket.write('/quit\n');
        } else if (input.trim().startsWith('/fileupload ')) {
            const parts = input.trim().split(' ');
            if (parts.length < 3) {
                console.log('Használat: /fileupload <helyi fájl elérési út> <célfájlnév>');
                rl.prompt();
                return;
            }
            const localPath = parts[1];
            const targetFilename = parts.slice(2).join(' ');
            if (!fs.existsSync(localPath)) {
                console.log('Helyi fájl nem található.');
                rl.prompt();
                return;
            }
            const stat = fs.statSync(localPath);
            if (!stat.isFile()) {
                console.log('A megadott elérési út nem fájl.');
                rl.prompt();
                return;
            }
            uploadInProgress = true;
            console.log(`Fájl beolvasása: ${localPath}`);
            const fileData = fs.readFileSync(localPath);
            const base64 = fileData.toString('base64');
            const size = base64.length;
            socket.write(`/fileupload ${localPath} ${targetFilename}\n`);
            setTimeout(() => {
                socket.write(`FILEUPLOAD ${targetFilename} ${size}\n`);
                for (let i = 0; i < size; i += 8000) {
                    socket.write(`FILEUPLOAD_DATA ${base64.substr(i, 8000)}\n`);
                }
                socket.write('FILEUPLOAD_END\n');
                console.log(`Feltöltés: ${targetFilename} (${fileData.length} byte)`);
            }, 100);
        } else {
            socket.write(input + '\n');
        }
    } else {
        if (input.trim() === '/quit') {
            socket.end();
        } else if (input.trim() === '/files') {
            socket.write('/files\n');
        } else {
            socket.write(input + '\n');
            const formatted = input.replace(/:-\)/g, '😊').replace(/:-D/g, '😃').replace(/:-P/g, '😛').replace(/:-\(/g, '😞').replace(/:3/g, '😊').replace(/<3/g, '❤️');
            console.log(`<${username}> ${formatted}`);
            addToChatBuffer(`<${username}> ${formatted}`);
        }
    }
});

createSocket();

process.on('SIGINT', () => {
    socket.end();
    process.exit();
});
