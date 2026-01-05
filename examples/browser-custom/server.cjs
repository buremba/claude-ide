// Simple HTTP server for testing browser customization
const http = require('http');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  console.log(`[server] ${req.method} ${req.url}`);

  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(`
<!DOCTYPE html>
<html>
<head>
  <title>Custom Browser Demo</title>
  <style>
    body { font-family: system-ui; padding: 2rem; max-width: 600px; margin: 0 auto; }
    h1 { color: #333; }
    .status { padding: 1rem; background: #e3f2fd; border-radius: 8px; margin: 1rem 0; }
    .info { color: #666; font-size: 0.9rem; }
    code { background: #f5f5f5; padding: 0.2rem 0.4rem; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>Browser Demo</h1>
  <div class="status">
    <p><strong>Check your window title!</strong></p>
    <p>The window title should show "MCP Sidecar [demo-server] - Custom Browser Demo"</p>
  </div>

  <h2>Features</h2>
  <ul>
    <li>Bookmarks bar with custom bookmarks</li>
    <li>Window title prefixed with process name</li>
    <li>React DevTools extension</li>
  </ul>

  <p class="info">
    Server running on port ${PORT}<br>
    Timestamp: ${new Date().toISOString()}
  </p>
</body>
</html>
  `);
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
