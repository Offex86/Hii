/**
 * VLESS Gaming Worker + Live Admin Panel
 * No KV Binding Required (Simple Setup)
 * Access Panel: your-domain.workers.dev/panel
 */

import { connect } from 'cloudflare:sockets';

// Global variables to store settings in memory
let globalConfig = {
    userID: 'd342d11e-d424-4583-b36e-524ab1f0afa4',
    panelPass: 'admin'
};

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        
        // 1. ADMIN PANEL ROUTE
        if (url.pathname === '/panel') {
            return handlePanel(request);
        }

        // 2. SAVE SETTINGS (API)
        if (url.pathname === '/save' && request.method === 'POST') {
            try {
                const data = await request.json();
                globalConfig.userID = data.uuid;
                globalConfig.proxyIP = data.proxy;
                return new Response('OK', { status: 200 });
            } catch (e) {
                return new Response('Error', { status: 400 });
            }
        }

        // 3. WEBSOCKET TUNNEL ROUTE
        if (request.headers.get('Upgrade') === 'websocket') {
            return await handleWebSocket(request);
        }

        return new Response('Gaming Tunnel is Online. Access /panel to customize.', { 
            status: 200,
            headers: { 'content-type': 'text/plain;charset=UTF-8' } 
        });
    }
};

// --- ADMIN PANEL HTML ---
function handlePanel(request) {
    const html = `
    <!DOCTYPE html>
    <html lang="hi">
    <head>
        <title>VLESS Admin Panel</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            body { font-family: 'Segoe UI', sans-serif; background: #0a0a0a; color: #fff; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
            .card { background: #151515; padding: 25px; border-radius: 15px; box-shadow: 0 8px 32px rgba(0,0,0,0.8); width: 90%; max-width: 400px; border: 1px solid #333; }
            h2 { color: #00ffcc; text-align: center; margin-bottom: 20px; text-transform: uppercase; letter-spacing: 2px; }
            label { font-size: 12px; color: #888; display: block; margin-bottom: 5px; margin-top: 15px; }
            input { width: 100%; padding: 12px; border-radius: 8px; border: 1px solid #444; background: #000; color: #00ffcc; box-sizing: border-box; font-family: monospace; }
            button { background: #00ffcc; color: #000; border: none; padding: 14px; border-radius: 8px; cursor: pointer; width: 100%; font-weight: bold; margin-top: 25px; transition: 0.3s; }
            button:hover { background: #00cca3; transform: scale(1.02); }
            #status { text-align: center; margin-top: 15px; font-size: 14px; color: #00ffcc; }
        </style>
    </head>
    <body>
        <div class="card">
            <h2>Gaming Panel</h2>
            <label>UUID:</label>
            <input type="text" id="uuid" value="${globalConfig.userID}">
            <label>Proxy IP (Gaming):</label>
            <input type="text" id="proxy" value="${globalConfig.proxyIP}" placeholder="e.g. 104.16.51.111">
            <button onclick="save()">SAVE SETTINGS</button>
            <p id="status"></p>
        </div>
        <script>
            async function save() {
                const status = document.getElementById('status');
                status.innerText = 'Saving...';
                const data = {
                    uuid: document.getElementById('uuid').value,
                    proxy: document.getElementById('proxy').value
                };
                const res = await fetch('/save', {
                    method: 'POST',
                    body: JSON.stringify(data),
                    headers: { 'Content-Type': 'application/json' }
                });
                if (res.ok) {
                    status.innerText = 'Settings Updated Successfully!';
                    setTimeout(() => status.innerText = '', 3000);
                } else {
                    status.innerText = 'Error Saving Settings';
                }
            }
        </script>
    </body>
    </html>
    `;
    return new Response(html, { headers: { 'Content-Type': 'text/html' } });
}

// --- WEBSOCKET LOGIC ---
async function handleWebSocket(request) {
    const webSocketPair = new WebSocketPair();
    const [client, webSocket] = Object.values(webSocketPair);
    webSocket.accept();

    let remoteSocketWrapper = { value: null };

    const readableWebSocketStream = new ReadableStream({
        start(controller) {
            webSocket.addEventListener('message', (e) => controller.enqueue(e.data));
            webSocket.addEventListener('close', () => controller.close());
            webSocket.addEventListener('error', (e) => controller.error(e));
        }
    });

    readableWebSocketStream.pipeTo(new WritableStream({
        async write(chunk) {
            if (remoteSocketWrapper.value) {
                const writer = remoteSocketWrapper.value.writable.getWriter();
                await writer.write(chunk);
                writer.releaseLock();
                return;
            }

            const vlessHeader = processHeader(chunk, globalConfig.userID);
            if (!vlessHeader) return;

            const { address, port, rawDataIndex } = vlessHeader;
            // Agar panel mein IP hai toh wo use hoga, varna header wala address
            const targetHost = globalConfig.proxyIP || address;

            try {
                const socket = connect({ hostname: targetHost, port: port });
                remoteSocketWrapper.value = socket;
                const writer = socket.writable.getWriter();
                await writer.write(chunk.slice(rawDataIndex));
                writer.releaseLock();
                pipeRemoteToWS(socket, webSocket);
            } catch (e) {
                console.error("Socket connection failed");
            }
        }
    }));

    return new Response(null, { status: 101, webSocket: client });
}

function processHeader(buffer, uuid) {
    if (buffer.byteLength < 24) return null;
    const id = Array.from(new Uint8Array(buffer.slice(1, 17))).map(b => b.toString(16).padStart(2, '0')).join('').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5");
    if (id !== uuid) return null;
    const optLen = new Uint8Array(buffer.slice(17, 18))[0];
    const port = new DataView(buffer.slice(18 + optLen + 1, 18 + optLen + 3)).getUint16(0);
    const addrType = new Uint8Array(buffer.slice(18 + optLen + 3, 18 + optLen + 4))[0];
    let addr = '';
    if (addrType === 1) addr = new Uint8Array(buffer.slice(18 + optLen + 4, 18 + optLen + 8)).join('.');
    else if (addrType === 2) addr = new TextDecoder().decode(buffer.slice(18 + optLen + 5, 18 + optLen + 5 + new Uint8Array(buffer.slice(18 + optLen + 4, 18 + optLen + 5))[0]));
    return { address: addr, port, rawDataIndex: buffer.byteLength - (buffer.byteLength - 24 - optLen) };
}

async function pipeRemoteToWS(socket, ws) {
    try {
        await socket.readable.pipeTo(new WritableStream({
            write(chunk) { if (ws.readyState === 1) ws.send(chunk); },
            close() { ws.close(); }
        }));
    } catch (e) { ws.close(); }
      }
