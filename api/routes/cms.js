'use strict';

// CMS do site (ver lib/cms.js). Ler e mudar: quem gere a configuração geral
// (proprietário ou equipa sem estúdio), como Música e Projetos.

const express = require('express');
const auth = require('../lib/auth');
const CMS = require('../lib/cms');

const router = express.Router();
router.use(auth.requireManager);

router.get('/', (_req, res) => res.json({ cms: CMS.ler(), ...CMS.catalogo() }));

router.put('/', async (req, res) => {
  res.json({ cms: await CMS.guardar(req.body) });
});

module.exports = router;
