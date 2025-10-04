const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { uniqueNamesGenerator, adjectives, animals, colors, names } = require('unique-names-generator');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  cookie: false
});

// Generate docId as "animal-object" like "lion-chair"
const generateDocId = () => {
  return uniqueNamesGenerator({
    dictionaries: [animals, colors],
    separator: '-',
    length: 2,
    style: 'lowerCase'
  });
};

// In-memory storage: docId => { text, users: Set<socketId> }
const documents = new Map();

app.use(express.static('public', {
  setHeaders: (res) => res.set('Cache-Control', 'no-store')
}));

// Root route
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// Create new document
app.get('/new', (req, res) => {
  let docId;
  let attempts = 0;
  do {
    docId = generateDocId();
    attempts++;
  } while (documents.has(docId) && attempts < 10);

  if (documents.has(docId)) return res.status(500).send('Unable to generate unique document ID');

  documents.set(docId, { text: '', users: new Set() });
  res.redirect(`/${docId}`);
});

// Access document
app.get('/:docId', (req, res) => {
  const { docId } = req.params;
  if (!documents.has(docId)) return res.sendFile(__dirname + '/public/index.html');
  res.sendFile(__dirname + '/public/index.html');
});

// Socket.io connection
io.on('connection', (socket) => {
  let currentDocId = null;

  socket.on('join', ({ docId }) => {
    if (!documents.has(docId)) {
      socket.emit('error', 'Document not found');
      return;
    }

    currentDocId = docId;
    socket.join(docId);
    documents.get(docId).users.add(socket.id);

    socket.emit('load', documents.get(docId).text);
    io.to(docId).emit('userCount', documents.get(docId).users.size);
  });

  socket.on('edit', ({ docId, text }) => {
    if (!documents.has(docId)) return;
    documents.get(docId).text = text;
    socket.to(docId).emit('update', text);
  });

  socket.on('disconnect', () => {
    if (!currentDocId || !documents.has(currentDocId)) return;
    const doc = documents.get(currentDocId);
    doc.users.delete(socket.id);
    io.to(currentDocId).emit('userCount', doc.users.size);

    if (doc.users.size === 0) {
      setTimeout(() => {
        if (documents.has(currentDocId) && documents.get(currentDocId).users.size === 0) {
          documents.delete(currentDocId);
          console.log(`Document deleted: ${currentDocId}`);
        }
      }, 300000); // 5 minutes
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
