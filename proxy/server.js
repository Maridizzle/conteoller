const path = require('path');
const express = require('express');
const session = require('express-session');

const config = require('./src/config');
const { requireAuth } = require('./src/auth');

const authRoutes = require('./src/routes/authRoutes');
const linkRoutes = require('./src/routes/link');
const callbackRoutes = require('./src/routes/callback');
const toysRoutes = require('./src/routes/toys');
const commandRoutes = require('./src/routes/command');
const stopRoutes = require('./src/routes/stop');
const harvestRoutes = require('./src/routes/harvest');
const calibrateRoutes = require('./src/routes/calibrate');
const panelConfigRoutes = require('./src/routes/panelConfig');

const app = express();
const isProd = process.env.NODE_ENV === 'production';

// Railway sits in front of us as a reverse proxy; trust it so secure
// cookies and req.protocol behave correctly.
app.set('trust proxy', 1);

app.use(express.json());

// CORS: allow only the panel's own origin (spec §5). Since the proxy also
// serves the panel, most requests are same-origin already; this only
// matters if CALLBACK_PUBLIC_URL differs from the browsing origin.
app.use((req, res, next) => {
  const allowedOrigin = config.server.callbackPublicUrl;
  if (allowedOrigin && req.headers.origin === allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Panel-Api-Key');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(
  session({
    secret: config.panel.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    },
  })
);

// --- Public routes ---
app.use('/auth', authRoutes);
app.use(callbackRoutes); // POST /callback — called by Lovense, not the panel

app.use('/css', express.static(path.join(__dirname, 'public', 'css')));
app.use('/js', express.static(path.join(__dirname, 'public', 'js')));
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// --- Authenticated API routes ---
// requireAuth is scoped to these exact path prefixes only — mounting it
// via `app.use(requireAuth, someRouter)` would attach it at the router's
// default '/' prefix and intercept every request (including '/' itself,
// before the redirect-to-login handler below ever runs).
const protectedPaths = ['/link', '/toys', '/command', '/stop', '/harvest', '/calibrate', '/config'];
app.use(protectedPaths, requireAuth);
app.use(linkRoutes);
app.use(toysRoutes);
app.use(commandRoutes);
app.use(stopRoutes);
app.use(harvestRoutes);
app.use(calibrateRoutes);
app.use(panelConfigRoutes);

// --- Authenticated panel shell ---
app.get('/', (req, res) => {
  if (!(req.session && req.session.authed)) return res.redirect('/login');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(config.server.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Lovense jog-wheel proxy listening on :${config.server.port}`);
});
