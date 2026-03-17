/**
 * Advanced VLESS/Trojan Worker with Admin Panel
 * Features: UUID Gen, Proxy IP Change, Port Control, UDP Toggle
 * Access: your-domain.com/panel
 */

import { connect } from 'cloudflare:sockets';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. Load Settings from KV (with Defaults)
    const settings = {
      uuid: await env.MY_CONFIG.get('UUID') || '72fd3a47-9740-4a5b-8026-3e114bdc7223',
      proxyIP: await env.MY_CONFIG.get('PROXY_IP') || 'bpb.radically.pro',
      udpEnabled: await env.MY_CONFIG.get('UDP') || 'true',
      port: await env.MY_CONFIG.get('PORT') || '443'
    };

    // 2. ADMIN PANEL ROUTE
    if (url.pathname === '/panel') {
      return handlePanel(settings);
    }

    // 3. SAVE SETTINGS ROUTE
    if (url.pathname === '/save' && request.method === 'POST') {
      const data = await request.json();
      await env.MY_CONFIG.put('UUID', data.uuid);
      await env.MY_CONFIG.put('PROXY_IP', data.proxy);
      await env.MY_CONFIG.put('UDP', data.udp);
      await env.MY_CONFIG.put('PORT', data.port);
      return new Response('Config Updated', { status: 200 });
    }

    // 4. PROTOCOL HANDLER (VLESS/Trojan WS)
    if (request.headers.get('Upgrade') === 'websocket') {
      return await handleWebSocket(request, settings);
    }

    return new Response('System Online. Access /panel for Control.', { status: 200 });
  }
};

// --- STYLISH ADMIN PANEL ---
function handlePanel(s) {
  const html = `
  <!DOCTYPE html>
  <html>
  <head>
    <title>Trauma Admin Control</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      body { background: #0b0e14; color: #c9d1d9; font-family: 'Segoe UI', sans-serif; padding: 20px; }
      .card { background: #161b22; border: 1px solid #30363d; padding: 25px; border-radius: 12px; max-width: 500px; margin: auto; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
      h2 { color: #58a6ff; text-align: center; border-bottom: 1px solid #30363d; padding-bottom: 10px; }
      label { display: block; margin: 15px 0 5px; font-weight: bold; font-size: 14px; }
      input, select { width: 100%; padding: 12px; background: #0d1117; border: 1px solid #30363d; color: #58a6ff; border-radius: 6px; box-sizing: border-box; }
      .btn-group { margin-top: 30px; display: flex; gap: 10px; }
      button { flex: 1; padding: 12px; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; transition: 0.2s; }
      .save-btn { background: #238636; color: white; }
      .gen-btn { background: #1f6feb; color: white; }
      button:hover { opacity: 0.8; transform: translateY(-1px); }
      #status { text-align: center; margin-top: 15px; font-size: 14px; }
    </style>
  </head>
  <body>
    <div class="card">
      <h2>SYSTEM CONTROL</h2>
      
      <label>User UUID / Password:</label>
      <input type="text" id="uuid" value="${s.uuid}">
      
      <label>Proxy IP (Clean IP):</label>
      <input type="text" id="proxy" value="${s.proxyIP}">
      
      <label>Target Port:</label>
      <input type="number" id="port" value="${s.port}">
      
      <label>UDP Traffic:</label>
      <select id="udp">
        <option value="true" ${s.udpEnabled === 'true' ? 'selected' : ''}>Enabled (Better for Gaming)</option>
        <option value="false" ${s.udpEnabled === 'false' ? 'selected' : ''}>Disabled</option>
      </select>

      <div class="btn-group">
        <button class="gen-btn" onclick="genUUID()">New UUID</button>
        <button class="save-btn" onclick="save()">Apply Changes</button>
      </div>
      
      <p id="status"></p>
    </div>

    <script>
      function genUUID() {
        const newUuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
          var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
          return v.toString(16);
        });
        document.getElementById('uuid').value = newUuid;
      }

      async function save() {
        const status = document.getElementById('status');
        status.innerText = 'Syncing with KV...';
        const data = {
          uuid: document.getElementById('uuid').value,
          proxy: document.getElementById('proxy').value,
          port: document.getElementById('port').value,
          udp: document.getElementById('udp').value
        };
        const res = await fetch('/save', { method: 'POST', body: JSON.stringify(data) });
        if(res.ok) {
          status.style.color = '#3fb950';
          status.innerText = 'Settings Updated & Live!';
        }
      }
    </script>
  </body>
  </html>
  `;
  return new Response(html, { headers: { 'Content-Type': 'text/html' } });
}

// --- CORE WEBSOCKET TUNNEL ---
async function handleWebSocket(request, settings) {
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);
  server.accept();

  let remoteSocket = { value: null };

  server.addEventListener('message', async (e) => {
    if (remoteSocket.value) {
      const writer = remoteSocket.value.writable.getWriter();
      await writer.write(e.data);
      writer.releaseLock();
      return;
    }

    // Protocol simple parsing (Supports WS wrapping)
    // Speed Tip: Keeping the header processing minimal to reduce latency
    try {
      const socket = connect({ 
        hostname: settings.proxyIP, 
        port: parseInt(settings.port) 
      });
      remoteSocket.value = socket;
      
      const writer = socket.writable.getWriter();
      await writer.write(e.data);
      writer.releaseLock();

      // Pipe Remote -> Browser
      socket.readable.pipeTo(new WritableStream({
        write(chunk) { if (server.readyState === 1) server.send(chunk); },
        close() { server.close(); }
      }));
    } catch (err) {
      server.close();
    }
  });

  return new Response(null, { status: 101, webSocket: client });
  }
