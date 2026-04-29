const fs = require('fs');
const http = require('http');
const path = require('path');
const vm = require('vm');
const ejs = require('ejs');
const { firebaseReady } = require('../config/firebaseAdmin');

const rootDir = path.resolve(__dirname, '..');

function walkFiles(dir, predicate, results = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;

        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walkFiles(fullPath, predicate, results);
        } else if (predicate(fullPath)) {
            results.push(fullPath);
        }
    }

    return results;
}

function checkJavaScriptSyntax() {
    const jsFiles = walkFiles(rootDir, file => file.endsWith('.js'));
    for (const file of jsFiles) {
        const source = fs.readFileSync(file, 'utf8').replace(/^#!.*\r?\n/, '');
        try {
            new vm.Script(`(function (exports, require, module, __filename, __dirname) {\n${source}\n})`, {
                filename: file
            });
        } catch (error) {
            throw new Error(`JavaScript syntax check failed for ${path.relative(rootDir, file)}\n${error.message}`);
        }
    }

    console.log(`OK JavaScript syntax (${jsFiles.length} files)`);
}

function checkEjsTemplates() {
    const viewFiles = walkFiles(path.join(rootDir, 'views'), file => file.endsWith('.ejs'));
    for (const file of viewFiles) {
        ejs.compile(fs.readFileSync(file, 'utf8'), { filename: file });
    }

    console.log(`OK EJS templates (${viewFiles.length} files)`);
}

function request(server, routePath) {
    const port = server.address().port;

    return new Promise((resolve, reject) => {
        const req = http.get({ host: '127.0.0.1', port, path: routePath }, (res) => {
            let body = '';
            res.on('data', chunk => {
                body += chunk;
            });
            res.on('end', () => {
                resolve({ statusCode: res.statusCode, headers: res.headers, body });
            });
        });

        req.on('error', reject);
    });
}

async function checkHttpSmoke() {
    const app = require('../app');
    const server = app.listen(0);

    try {
        await new Promise(resolve => server.once('listening', resolve));

        const login = await request(server, '/login');
        if (firebaseReady) {
            if (login.statusCode !== 200 || !login.body.includes('Admin')) {
                throw new Error(`Expected /login to render, got ${login.statusCode}`);
            }
        } else if (login.statusCode !== 503) {
            throw new Error(`Expected /login to show configuration warning, got ${login.statusCode}`);
        }

        const protectedRoute = await request(server, '/attendance-monitor');
        if (firebaseReady) {
            if (protectedRoute.statusCode !== 302 || protectedRoute.headers.location !== '/login') {
                throw new Error(`Expected /attendance-monitor to redirect to /login, got ${protectedRoute.statusCode}`);
            }
        } else if (protectedRoute.statusCode !== 503) {
            throw new Error(`Expected /attendance-monitor to show configuration warning, got ${protectedRoute.statusCode}`);
        }

        console.log('OK HTTP smoke routes');
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
}

async function main() {
    checkJavaScriptSyntax();
    checkEjsTemplates();
    await checkHttpSmoke();
}

main().catch(error => {
    console.error(error.stack || error.message);
    process.exit(1);
});
