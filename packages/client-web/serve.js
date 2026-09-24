const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const FILE_PATH = path.join(__dirname, 'index.html');

const server = http.createServer((req, res) => {
  fs.readFile(FILE_PATH, (err, data) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Error loading UI');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`\n=========================================================`);
  console.log(`  Food Budget Optimizer Web UI is running!`);
  console.log(`  Open your browser at: http://localhost:${PORT}`);
  console.log(`=========================================================\n`);
});
