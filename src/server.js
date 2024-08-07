import busboy from 'busboy';
import cors from 'cors';
import crypto from 'crypto';
import errorMiddleware from './errorMiddleware.js';
import ews from 'express-ws';
import express from 'express';
import feathersService from './feathersService.js';
import fetch from 'node-fetch';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import scrub from './scrubber.js';
import webPush from 'web-push';
import { nanoid } from 'nanoid';
import { setupWSConnection } from '@stoplight/y-websocket/bin/utils';

let app = express();
let port = process.env.PORT || 3000;
let trustProxy = JSON.parse(process.env.TRUST_PROXY || '0');
let rateLimitWindow = JSON.parse(process.env.RATE_LIMIT_WINDOW || '60000');
let rateLimitMaxReqs = JSON.parse(process.env.RATE_LIMIT_MAX_REQS || '50');
let scrubPasswords = x => scrub(x, ['password'], 'test');

if (trustProxy) {
  app.enable('trust proxy');
}

app.use(rateLimit({
  windowMs: rateLimitWindow,
  max: rateLimitMaxReqs,
}));

app.use(helmet());
app.use(cors());

ews(app, null, { perMessageDeflate: false });
app.use(express.json());

app.use((req, res, next) => {
  req.id = crypto.randomUUID();
  Object.keys(req.query).length && scrubPasswords(req.query);
  req.body && scrubPasswords(req.body);
  next();
});

let reqPath = req =>
  decodeURIComponent(new URL(`http://unused/${req.originalUrl}`).pathname)
  .slice(1);

app.use((req, res, next) => {
  let path = reqPath(req);

  console.log(req.method, path, JSON.stringify({
    ip: req.ip,
    method: req.method,
    path,
    query: req.query,
    body: req.body,
    reqId: req.id,
  }));

  next();
});

app.get('/status', (req, res) => res.send('OK'));
app.post('/:ns/log', (req, res) => res.sendStatus(204));

if (process.env.VAPID_PUB && process.env.VAPID_PVT) {
  webPush.setVapidDetails(
    'mailto:guilherme.pra.vieira@gmail.com',
    process.env.VAPID_PUB,
    process.env.VAPID_PVT,
  );

  app.post('/push', async (req, res) => {
    try {
      res.send(await webPush.sendNotification(req.body.sub, JSON.stringify(req.body.body)));
    }
    catch (err) {
      console.error(err);
      res.send(err);
    }
  });
}

let wsRooms = {};

app.ws('/rooms/:id', (ws, req) => {
  let room = wsRooms[req.params.id];
  if (!room) {
    room = wsRooms[req.params.id] = { owner: ws, peers: {} };

    ws.on('message', msg => {
      try {
        msg = JSON.parse(msg);
      } catch (err) {
        ws.send(JSON.stringify({ error: 'bad payload' }));
        console.error(err);
        return;
      }

      if (msg.to === '*') {
        for (let peer of Object.values(room.peers)) { peer.send(JSON.stringify(msg)) }
      } else {
        room.peers[msg.to].send(JSON.stringify(msg));
      }
    });

    ws.on('close', () => {
      for (let peer of Object.values(room.peers)) { peer.close() }
      delete wsRooms[req.params.id];
    });

    ws.send(JSON.stringify({ role: 'owner' }));
  } else {
    let id = nanoid();
    room.peers[id] = ws;
    ws.send(JSON.stringify({ role: 'peer', id }));
    room.owner.send(JSON.stringify({ open: id }));
    ws.on('message', msg => {
      let body;
      try {
        body = JSON.parse(msg);
      } catch (err) {
        ws.send(JSON.stringify({ error: 'bad payload' }));
        console.error(err);
        return;
      }
      room.owner.send(JSON.stringify({ from: id, body: JSON.parse(msg) }));
    });
    ws.on('close', () => {
      room.owner.send(JSON.stringify({ close: id }));
      delete room.peers[id];
    });
  }
});

let yjsro = {}; // FIXME: Persistence
app.ws('/yjs/:id', (ws, req) => {
  if (req.params.id.startsWith('ro--')) {
    let originalId = yjsro[req.params.id];
    if (!originalId) { console.log('[YJS] Read-only endpoint not found:', req.params.id); ws.close(); return }
    req.url = `/yjs/${originalId}/.websocket`;
    ws.readOnly = true;
    console.log('Opening read-only endpoint:', req.params.id, '=>',originalId);
  } else if (req.query.roid) {
    yjsro[req.query.roid] = req.params.id;
    console.log('Creating read-only endpoint:', req.query.roid, '=>', req.params.id);
  }
  setupWSConnection(ws, req);
});

app.post('/:ns/:collection', async (req, res) => {
  try {
    let { ns, collection } = req.params;
    let sv = await feathersService(ns, collection);

    res.send(await sv.create(req.body, { query: req.query }));
  }
  catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

app.put('/:ns/:collection/:id', async (req, res) => {
  try {
    let { ns, collection, id } = req.params;
    let sv = await feathersService(ns, collection);

    res.send(await sv.update(id, req.body, {
      nedb: { upsert: true },
    }));
  }
  catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

app.get('/:ns/:collection/:id', async (req, res) => {
  try {
    let { ns, collection, id } = req.params;
    let sv = await feathersService(ns, collection);

    res.send(await sv.get(id));
  }
  catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

app.get('/:ns/:collection', async (req, res) => {
  try {
    let { ns, collection } = req.params;
    let sv = await feathersService(ns, collection);

    res.send(await sv.find({
      query: req.query,
      // TODO: pagination params
    }));
  }
  catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

app.patch('/:ns/:collection/:id', async (req, res) => {
  try {
    let { ns, collection, id } = req.params;
    let sv = await feathersService(ns, collection);

    res.send(await sv.patch(id, req.body));
  }
  catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

app.patch('/:ns/:collection', async (req, res) => {
  try {
    let { ns, collection } = req.params;
    let sv = await feathersService(ns, collection);

    if (!Object.keys(req.query).length) {
      throw new Error(`missing query`);
    }

    res.send(await sv.patch(null, req.body, { query: req.query }));
  }
  catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

app.delete('/:ns/:collection/:id', async (req, res) => {
  try {
    let { ns, collection, id } = req.params;
    let sv = await feathersService(ns, collection);

    res.send(await sv.remove(id, req.body));
  }
  catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

app.delete('/:ns/:collection', async (req, res) => {
  try {
    let { ns, collection } = req.params;
    let sv = await feathersService(ns, collection);

    if (!Object.keys(req.query).length) {
      throw new Error(`missing query`);
    }

    res.send(await sv.remove(null, req.body, { query: req.query }));
  }
  catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

app.post('/netlify/deploy/:id', async (req, res) => {
  try {
    let bus = busboy({ headers: req.headers });

    bus.on('file', async (field, file, name, encoding, mimeType) => {
      try {
        let res2 = await fetch(`https://api.netlify.com/api/v1/sites/${req.params.id}/deploys`, {
          method: 'POST',
          headers: {
            Authorization: req.headers.authorization,
            'Content-Type': 'application/zip',
          },
          body: file,
          duplex: 'half',
        });

        if (!res2.ok) { console.log(await res2.json()); throw new Error('Deploy failed') }
        res.send(await res2.json());
      } catch (err) {
        console.error(err);
        res.sendStatus(500);
      }
    });

    req.pipe(bus);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

app.use(errorMiddleware);

app.listen(port);
console.log(`Listening on :${port}...`);
