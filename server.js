// ============================================
// SERVER.JS — CONTAS A PAGAR (aplicação standalone)
// ============================================
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── SUPABASE ──────────────────────────────────────────────────────────────
// Configure estas variáveis no ambiente do Render (Settings → Environment):
//   SUPABASE_URL               → URL do seu projeto Supabase
//   SUPABASE_SERVICE_ROLE_KEY  → chave "service_role" (nunca a "anon")
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ ERRO: Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY nas variáveis de ambiente do Render.');
    process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);

// ─── MIDDLEWARES ─────────────────────────────────────────────────────────────
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── ARQUIVOS ESTÁTICOS (front-end) ──────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ─── HEALTH CHECK ────────────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
    try {
        const { error } = await supabase.from('contas_pagar').select('id', { count: 'exact', head: true });
        res.json({
            status: error ? 'unhealthy' : 'healthy',
            database: error ? 'disconnected' : 'connected',
            timestamp: new Date().toISOString()
        });
    } catch {
        res.json({ status: 'unhealthy', timestamp: new Date().toISOString() });
    }
});
app.get('/api/health', (req, res) => res.redirect(307, '/health'));

// ─── API DE CONTAS A PAGAR ────────────────────────────────────────────────────
const contasPagarRoutes = require('./routes');
app.use('/api', contasPagarRoutes(supabase));

// ─── FALLBACK: qualquer rota não-API devolve o front-end (SPA) ──────────────
app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── 404 (rotas /api não encontradas) ────────────────────────────────────────
app.use((req, res) => { res.status(404).json({ error: '404 - Rota não encontrada' }); });

// ─── TRATAMENTO DE ERROS ──────────────────────────────────────────────────────
app.use((error, req, res, next) => {
    console.error('Erro interno:', error.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
});

// ─── INICIAR ──────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✅ Contas a Pagar rodando na porta ${PORT}`);
    console.log('✅ Database: Supabase conectado');
    console.log('\n📡 Rotas de API registradas:');
    console.log('  GET    /health                → Health check');
    console.log('  GET    /api/contas             → Listar contas (filtros ?mes=&ano=)');
    console.log('  GET    /api/contas/grupo/:id   → Listar parcelas de um grupo');
    console.log('  POST   /api/contas             → Criar conta');
    console.log('  PUT    /api/contas/:id         → Atualizar conta');
    console.log('  PATCH  /api/contas/:id         → Atualizar status/pagamento');
    console.log('  DELETE /api/contas/:id         → Excluir conta\n');
});
