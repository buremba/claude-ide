// Simple HTTP server for testing browser integration
const http = require('http');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  console.log(`[server] ${req.method} ${req.url}`);

  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(`
<!DOCTYPE html>
<html>
<head>
  <title>MCP Sidecar Browser Demo</title>
  <style>
    body { font-family: system-ui; padding: 2rem; max-width: 600px; margin: 0 auto; }
    h1 { color: #333; }
    .status { padding: 1rem; background: #e8f5e9; border-radius: 8px; margin: 1rem 0; }
    .info { color: #666; font-size: 0.9rem; }
    button { padding: 0.5rem 1rem; margin: 0.5rem; cursor: pointer; }
    #counter { font-size: 2rem; font-weight: bold; }
  </style>
</head>
<body>
  <h1>MCP Sidecar Browser Demo</h1>
  <div class="status">
    <p>Server is running on port ${PORT}</p>
    <p>Timestamp: ${new Date().toISOString()}</p>
  </div>

  <h2>Interactive Test</h2>
  <p>Counter: <span id="counter">0</span></p>
  <button onclick="increment()">Increment</button>
  <button onclick="decrement()">Decrement</button>

  <h2>Local Storage Test</h2>
  <p>Value: <span id="storage-value">(none)</span></p>
  <button onclick="setStorage()">Set Value</button>
  <button onclick="getStorage()">Get Value</button>

  <p class="info">
    Use browser_eval tool to interact with this page.<br>
    Example: <code>document.getElementById('counter').textContent</code>
  </p>

  <script>
    let count = 0;
    function increment() { document.getElementById('counter').textContent = ++count; }
    function decrement() { document.getElementById('counter').textContent = --count; }
    function setStorage() {
      localStorage.setItem('demo', 'hello-' + Date.now());
      getStorage();
    }
    function getStorage() {
      document.getElementById('storage-value').textContent = localStorage.getItem('demo') || '(none)';
    }
    getStorage();
  </script>
</body>
</html>
  `);
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
