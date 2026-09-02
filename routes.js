// ============================================
// ROUTES — CONTAS A PAGAR
// ============================================
const express = require('express');

module.exports = function (supabase) {
    const router = express.Router();

    // ─── GET /api/contas ────────────────────────────────────────────────────
    router.get('/contas', async (req, res) => {
        try {
            const { mes, ano } = req.query;

            let query = supabase
                .from('contas_pagar')
                .select('*')
                .order('data_vencimento', { ascending: true })
                .order('id', { ascending: true });

            if (mes && ano) {
                const mesNum  = parseInt(mes);
                const anoNum  = parseInt(ano);
                const inicio  = `${anoNum}-${String(mesNum).padStart(2, '0')}-01`;
                const fimDate = new Date(anoNum, mesNum, 0);
                const fim     = fimDate.toISOString().split('T')[0];
                query = query.gte('data_vencimento', inicio).lte('data_vencimento', fim);
            }

            const { data, error } = await query;
            if (error) throw error;
            res.json(data);
        } catch (err) {
            console.error('[pagar] GET /contas:', err.message);
            res.status(500).json({ error: err.message });
        }
    });

    // ─── GET /api/contas/grupo/:grupoId ─────────────────────────────────────
    router.get('/contas/grupo/:grupoId', async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('contas_pagar')
                .select('*')
                .eq('grupo_id', req.params.grupoId)
                .order('parcela_numero', { ascending: true });
            if (error) throw error;
            res.json(data);
        } catch (err) {
            console.error('[pagar] GET /contas/grupo:', err.message);
            res.status(500).json({ error: err.message });
        }
    });

    // ─── POST /api/contas ───────────────────────────────────────────────────
    router.post('/contas', async (req, res) => {
        try {
            const body = req.body;
            delete body.id;
            delete body.created_at;
            delete body.updated_at;

            const { data, error } = await supabase
                .from('contas_pagar')
                .insert([body])
                .select()
                .single();
            if (error) throw error;
            res.status(201).json(data);
        } catch (err) {
            console.error('[pagar] POST /contas:', err.message);
            res.status(500).json({ error: err.message });
        }
    });

    // ─── PUT /api/contas/:id ────────────────────────────────────────────────
    router.put('/contas/:id', async (req, res) => {
        try {
            const body = { ...req.body };
            delete body.id;
            delete body.created_at;
            body.updated_at = new Date().toISOString();

            const { data, error } = await supabase
                .from('contas_pagar')
                .update(body)
                .eq('id', req.params.id)
                .select()
                .single();
            if (error) throw error;
            if (!data) return res.status(404).json({ error: 'Conta não encontrada' });
            res.json(data);
        } catch (err) {
            console.error('[pagar] PUT /contas/:id:', err.message);
            res.status(500).json({ error: err.message });
        }
    });

    // ─── PATCH /api/contas/:id (NOVO – resolve o erro 404 no toggle) ────────
    router.patch('/contas/:id', async (req, res) => {
        try {
            const updates = { ...req.body, updated_at: new Date().toISOString() };
            delete updates.id;
            delete updates.created_at;

            const { data, error } = await supabase
                .from('contas_pagar')
                .update(updates)
                .eq('id', req.params.id)
                .select()
                .single();
            if (error) throw error;
            if (!data) return res.status(404).json({ error: 'Conta não encontrada' });
            res.json(data);
        } catch (err) {
            console.error('[pagar] PATCH /contas/:id:', err.message);
            res.status(500).json({ error: err.message });
        }
    });

    // ─── DELETE /api/contas/:id ─────────────────────────────────────────────
    router.delete('/contas/:id', async (req, res) => {
        try {
            const { error } = await supabase
                .from('contas_pagar')
                .delete()
                .eq('id', req.params.id);
            if (error) throw error;
            res.json({ success: true });
        } catch (err) {
            console.error('[pagar] DELETE /contas/:id:', err.message);
            res.status(500).json({ error: err.message });
        }
    });

    return router;
};
