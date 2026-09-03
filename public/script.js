// ============================================
// CONFIGURAÇÃO
// ============================================
const PORTAL_URL = window.location.origin;
const API_URL = window.location.origin + '/api';

let contas = [];
let isOnline = false;
let lastDataHash = '';
let sessionToken = null;
let currentMonth = new Date();

let observacoesArray = [];
let tentativasReconexao = 0;
const MAX_TENTATIVAS = 3;

let contaParaRepetir = null;
let mesesSelecionadosRepetir = new Set();
let calendarMode = 'navigate';
let painelYear = new Date().getFullYear();

const meses = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

// ============================================
// QUEUE DE PROCESSAMENTO EM BACKGROUND
// ============================================
const processingQueue = {
    items: [],
    isProcessing: false,
    retryAttempts: 3
};

function addToQueue(item) {
    processingQueue.items.push({
        ...item,
        id: generateUUID(),
        attempts: 0,
        status: 'pending'
    });
}

async function processQueue() {
    if (processingQueue.isProcessing || processingQueue.items.length === 0) return;
    
    processingQueue.isProcessing = true;
    const BATCH_SIZE = 5;
    
    while (processingQueue.items.length > 0) {
        const batch = processingQueue.items.slice(0, BATCH_SIZE);
        await Promise.allSettled(batch.map(item => processSingleItem(item)));
        processingQueue.items = processingQueue.items.filter(item => item.status !== 'success');
    }
    
    processingQueue.isProcessing = false;
}

async function processSingleItem(item) {
    try {
        // Remove campos que não devem ser enviados
        const dataToSend = { ...item.data };
        delete dataToSend.tempId;
        delete dataToSend.synced;
        delete dataToSend.id;

        const response = await fetch(`${API_URL}/contas`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Session-Token': sessionToken,
                'Accept': 'application/json'
            },
            body: JSON.stringify(dataToSend),
            mode: 'cors'
        });

        if (tratarErroAutenticacao(response)) {
            item.status = 'auth_error';
            return;
        }

        if (response.ok) {
            const savedData = await response.json();
            const index = contas.findIndex(c => c.tempId === item.tempId);
            if (index !== -1) {
                contas[index] = { ...savedData, tempId: item.tempId, synced: true };
            }
            item.status = 'success';
            console.log(`✅ Conta ${item.tempId} salva com sucesso`);
            updateAllFilters();
            updateDashboard();
            filterContas();
        } else {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Erro ${response.status}`);
        }
    } catch (error) {
        console.error(`❌ Erro ao processar item ${item.tempId}:`, error);
        item.attempts++;
        
        if (item.attempts >= processingQueue.retryAttempts) {
            item.status = 'failed';
            showMessage(`Falha ao salvar conta: ${error.message}`, 'error');
            contas = contas.filter(c => c.tempId !== item.tempId);
            updateDashboard();
            filterContas();
        } else {
            item.status = 'retry';
            await new Promise(resolve => setTimeout(resolve, 1000 * item.attempts));
        }
    }
}

console.log('🚀 Contas a Pagar iniciada');

document.addEventListener('DOMContentLoaded', () => {
    console.log('📄 DOM carregado');
    
    document.addEventListener('click', function(e) {
        const btn = e.target.closest('[data-action]');
        if (btn) {
            e.stopPropagation();
            const action = btn.dataset.action;
            const id = btn.dataset.id;
            console.log(`🎯 Ação: ${action}, ID: ${id}`);
            if (!id && action !== 'new-conta') {
                console.error('❌ ID não encontrado no botão');
                return;
            }
            switch(action) {
                case 'view':
                    window.viewConta(id);
                    break;
                case 'view-obs':
                    window.viewConta(id, 'observacoes');
                    break;
                case 'edit':
                    window.editConta(id);
                    break;
                case 'delete':
                    window.deleteConta(id);
                    break;
                case 'toggle':
                    window.togglePago(id);
                    break;
                case 'repeat':
                    window.abrirRepetirModal(id);
                    break;
                case 'new-conta':
                    window.showFormModal(null);
                    break;
                default:
                    console.warn('Ação desconhecida:', action);
            }
            return;
        }
        
        const row = e.target.closest('tr[data-conta-id]');
        if (row && !e.target.closest('.action-btn') && !e.target.closest('.check-btn')) {
            const contaId = row.dataset.contaId;
            if (contaId) window.viewConta(contaId);
        }
    });
    
    verificarAutenticacao();
});

// ============================================
// NAVEGAÇÃO POR MESES
// ============================================
function updateDisplay() {
    const display = document.getElementById('currentMonth');
    if (display) {
        display.textContent = `${meses[currentMonth.getMonth()]} ${currentMonth.getFullYear()}`;
    }
    updateDashboard();
    filterContas();
}

window.changeMonth = function(direction) {
    currentMonth.setMonth(currentMonth.getMonth() + direction);
    updateDisplay();
};

window.previousMonth = function() {
    window.changeMonth(-1);
};

window.nextMonth = function() {
    window.changeMonth(1);
};

// ============================================
// AUTENTICAÇÃO
// ============================================
function verificarAutenticacao() {
    inicializarApp();
}

function tratarErroAutenticacao(response) {
    if (response && response.status === 401) {
        console.log('❌ Não autorizado pelo servidor (401)');
        tentativasReconexao++;

        if (tentativasReconexao < MAX_TENTATIVAS) {
            console.log(`🔄 Tentativa ${tentativasReconexao} de ${MAX_TENTATIVAS} - aguardando 2s...`);
            setTimeout(() => {
                checkServerStatus().catch(err => console.warn('Erro na tentativa de reconexão:', err));
            }, 2000);
            return true;
        } else {
            console.log('❌ Máximo de tentativas atingido - Continuando em modo offline');
            isOnline = false;
            showMessage('Sem conexão com o servidor - Modo offline ativado', 'warning');
            return true;
        }
    }
    return false;
}

function inicializarApp() {
    console.log('🚀 Iniciando aplicação...');
    tentativasReconexao = 0;
    updateDisplay();
    
    checkServerStatus().catch(err => {
        console.warn('⚠️ Erro ao verificar servidor:', err);
        isOnline = false;
    });
    
    setInterval(() => {
        checkServerStatus().catch(err => console.warn('Erro no polling:', err));
    }, 15000);
    startPolling();
}

// ============================================
// CONEXÃO E STATUS
// ============================================
async function checkServerStatus() {
    try {
        const response = await fetch(`${API_URL}/contas`, {
            method: 'GET',
            headers: { 
                'Accept': 'application/json'
            },
            mode: 'cors',
            signal: AbortSignal.timeout(5000)
        });

        if (tratarErroAutenticacao(response)) return false;

        const wasOffline = !isOnline;
        isOnline = response.ok;
        
        if (wasOffline && isOnline) {
            console.log('✅ SERVIDOR ONLINE - Sincronizando pendências...');
            tentativasReconexao = 0;
            await loadContas();
            
            if (processingQueue.items.length > 0) {
                showMessage('Sincronizando contas pendentes...', 'info');
                processQueue();
            }
        }
        
        return isOnline;
    } catch (error) {
        console.warn('⚠️ Erro ao verificar servidor:', error.message);
        isOnline = false;
        return false;
    }
}

// ============================================
// CARREGAMENTO DE DADOS
// ============================================
async function loadContas() {
    if (!isOnline) return;

    try {
        const response = await fetch(`${API_URL}/contas`, {
            method: 'GET',
            headers: { 
                'X-Session-Token': sessionToken,
                'Accept': 'application/json'
            },
            mode: 'cors'
        });

        if (tratarErroAutenticacao(response)) return;
        if (!response.ok) return;

        const data = await response.json();
        contas = data;
        
        const newHash = JSON.stringify(contas.map(c => c.id));
        if (newHash !== lastDataHash) {
            lastDataHash = newHash;
            updateAllFilters();
            updateDashboard();
            filterContas();
        }
    } catch (error) {
        console.error('❌ Erro ao carregar:', error);
    }
}

function startPolling() {
    loadContas();
    setInterval(() => {
        if (isOnline) loadContas();
    }, 10000);
}

// ============================================
// DASHBOARD
// ============================================
function updateDashboard() {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    
    const contasDoMes = contas.filter(c => {
        const dataVenc = new Date(c.data_vencimento + 'T00:00:00');
        return dataVenc.getMonth() === currentMonth.getMonth() && dataVenc.getFullYear() === currentMonth.getFullYear();
    });
    
    const valorPago = contasDoMes
        .filter(c => c.status === 'PAGO')
        .reduce((sum, c) => sum + parseFloat(c.valor_pago || 0), 0);
    
    const contasVencidas = contas.filter(c => {
        if (c.status === 'PAGO') return false;
        const dataVenc = new Date(c.data_vencimento + 'T00:00:00');
        dataVenc.setHours(0, 0, 0, 0);
        return dataVenc <= hoje;
    });
    const qtdVencido = contasVencidas.length;
    
    const valorTotalInicial = contasDoMes.reduce((sum, c) => sum + parseFloat(c.valor || 0), 0);
    const valorPendente = valorTotalInicial - valorPago;
    
    document.getElementById('statPagos').textContent = `R$ ${valorPago.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
    document.getElementById('statVencido').textContent = qtdVencido;
    document.getElementById('statPendente').textContent = `R$ ${valorPendente.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
    document.getElementById('statValorTotal').textContent = `R$ ${valorTotalInicial.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
    
    const cardVencido = document.getElementById('cardVencido');
    const pulseBadge = document.getElementById('pulseBadge');
    
    if (qtdVencido > 0) {
        cardVencido.classList.add('has-alert');
        if (pulseBadge) {
            pulseBadge.style.display = 'flex';
            pulseBadge.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
        }
    } else {
        cardVencido.classList.remove('has-alert');
        if (pulseBadge) pulseBadge.style.display = 'none';
    }
}

// ============================================
// MODAL DE VENCIDOS
// ============================================
window.showVencidoModal = function() {
    console.log('🔔 showVencidoModal chamado');
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    
    const contasVencidas = contas.filter(c => {
        if (c.status === 'PAGO') return false;
        const dataVenc = new Date(c.data_vencimento + 'T00:00:00');
        dataVenc.setHours(0, 0, 0, 0);
        return dataVenc <= hoje;
    });
    
    contasVencidas.sort((a, b) => new Date(a.data_vencimento) - new Date(b.data_vencimento));
    
    const modal = document.getElementById('vencidoModal');
    const body = document.getElementById('vencidoModalBody');
    
    if (contasVencidas.length === 0) {
        body.innerHTML = `<div style="text-align:center;padding:3rem;color:var(--text-secondary);"><svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.3;margin-bottom:1rem;"><circle cx="12" cy="12" r="10"></circle><path d="M12 8l0 4"></path><path d="M12 16l.01 0"></path></svg><p style="font-size:1.1rem;font-weight:600;margin:0;">Nenhuma conta vencida</p><p style="font-size:0.9rem;margin-top:0.5rem;">Todas as contas estão dentro do prazo ou foram pagas</p></div>`;
    } else {
        body.innerHTML = `<div style="overflow-x:auto;"><table>
            <thead>
                <tr><th>Descrição</th><th>Data de Vencimento</th><th style="text-align:right;">Valor</th><th style="text-align:center;">Dias Atraso</th></tr>
            </thead>
            <tbody>${contasVencidas.map(c => {
                const dataVenc = new Date(c.data_vencimento + 'T00:00:00');
                const diasAtraso = Math.floor((hoje - dataVenc) / (1000 * 60 * 60 * 24));
                return `<tr>
                            <td style="word-break:break-word;">${c.descricao}</td>
                            <td style="white-space:nowrap;">${formatDate(c.data_vencimento)}</td>
                            <td style="text-align:right;font-weight:700;color:#EF4444;">R$ ${parseFloat(c.valor).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
                            <td style="text-align:center;"><span class="badge vencido">${diasAtraso} dia${diasAtraso!==1?'s':''}</span></td>
                         </tr>`;
            }).join('')}</tbody>
        </table></div>`;
    }
    
    modal.style.display = 'flex';
};

window.closeVencidoModal = function() {
    const modal = document.getElementById('vencidoModal');
    if (modal) {
        modal.style.animation = 'fadeOut 0.2s ease forwards';
        setTimeout(() => { modal.style.display = 'none'; modal.style.animation = ''; }, 200);
    }
};

// ============================================
// PDF - GERAR RELATÓRIO
// ============================================
function formatBRL(valor) {
    return `R$ ${parseFloat(valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

window.gerarPDF = function() {
    const filtrados = getDadosFiltrados();
    if (!filtrados.length) {
        showMessage('Não há dados para gerar o PDF', 'warning');
        return;
    }
    
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    
    doc.setFontSize(16);
    doc.setFont(undefined, 'bold');
    doc.text('RELATÓRIO DE CONTAS A PAGAR', 14, 20);
    
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    const mesAno = `${meses[currentMonth.getMonth()]} ${currentMonth.getFullYear()}`;
    doc.text(`Período: ${mesAno}`, 14, 28);
    doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, 14, 34);
    
    const filtroBanco = document.getElementById('filterBanco').value;
    const filtroPagamento = document.getElementById('filterPagamento').value;
    const filtroStatus = document.getElementById('filterStatus').value;
    let filtrosTexto = [];
    if (filtroBanco) filtrosTexto.push(`Banco: ${filtroBanco}`);
    if (filtroPagamento) filtrosTexto.push(`Pagamento: ${filtroPagamento}`);
    if (filtroStatus) filtrosTexto.push(`Status: ${filtroStatus}`);
    if (filtrosTexto.length) {
        doc.text(`Filtros: ${filtrosTexto.join(' | ')}`, 14, 40);
    }
    
    const tableData = filtrados.map(c => {
        return [
            c.descricao,
            formatBRL(c.valor),
            c.valor_pago ? formatBRL(c.valor_pago) : '-',
            formatDate(c.data_vencimento),
            c.banco || '-',
            c.data_pagamento ? formatDate(c.data_pagamento) : '-'
        ];
    });
    
    doc.autoTable({
        startY: 48,
        head: [['Descrição', 'Valor Inicial', 'Valor Pago', 'Vencimento', 'Banco', 'Data Pagamento']],
        body: tableData,
        theme: 'striped',
        headStyles: { fillColor: [100, 100, 100], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
        styles: { fontSize: 9, cellPadding: 3, valign: 'middle' },
        columnStyles: {
            0: { cellWidth: 'auto', lineWidth: 0.2 },
            1: { halign: 'right', cellWidth: 28 },
            2: { halign: 'right', cellWidth: 28 },
            3: { halign: 'center', cellWidth: 22 },
            4: { halign: 'left', cellWidth: 30 },
            5: { halign: 'center', cellWidth: 28 }
        },
        margin: { left: 14, right: 14 }
    });
    
    const totalPago = filtrados.filter(c => c.status === 'PAGO').reduce((s, c) => s + parseFloat(c.valor_pago || 0), 0);
    const totalPendente = filtrados.filter(c => c.status !== 'PAGO').reduce((s, c) => s + parseFloat(c.valor || 0), 0);
    const totalGeral = filtrados.reduce((s, c) => s + parseFloat(c.valor || 0), 0);
    const finalY = doc.lastAutoTable.finalY + 10;
    
    doc.setFontSize(10);
    doc.setFont(undefined, 'bold');
    doc.text(`Total Pago: ${formatBRL(totalPago)}`, 14, finalY);
    doc.text(`Total Pendente: ${formatBRL(totalPendente)}`, 100, finalY);
    doc.text(`Total Geral: ${formatBRL(totalGeral)}`, 190, finalY);
    
    const nomeArquivo = `contas_pagar_${mesAno.replace(' ', '_')}.pdf`;
    doc.save(nomeArquivo);
    showMessage('PDF gerado com sucesso', 'success');
};

function getDadosFiltrados() {
    const search = (document.getElementById('search')?.value || '').toLowerCase();
    const banco = document.getElementById('filterBanco')?.value || '';
    const status = document.getElementById('filterStatus')?.value || '';
    const pagamento = document.getElementById('filterPagamento')?.value || '';
    let filtered = contas.filter(c => {
        const dataVenc = new Date(c.data_vencimento + 'T00:00:00');
        return dataVenc.getMonth() === currentMonth.getMonth() && dataVenc.getFullYear() === currentMonth.getFullYear();
    });
    if (banco) filtered = filtered.filter(c => c.banco === banco);
    if (pagamento) filtered = filtered.filter(c => c.forma_pagamento === pagamento);
    if (status) {
        const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
        filtered = filtered.filter(c => {
            if (status === 'PAGO') return c.status === 'PAGO';
            if (status === 'VENCIDO') {
                if (c.status === 'PAGO') return false;
                const dataVenc = new Date(c.data_vencimento + 'T00:00:00'); dataVenc.setHours(0, 0, 0, 0);
                return dataVenc <= hoje;
            }
            if (status === 'PENDENTE') {
                if (c.status === 'PAGO') return false;
                const dataVenc = new Date(c.data_vencimento + 'T00:00:00'); dataVenc.setHours(0, 0, 0, 0);
                return dataVenc > hoje;
            }
            return true;
        });
    }
    if (search) {
        filtered = filtered.filter(c => (c.descricao || '').toLowerCase().includes(search) ||
            (c.banco || '').toLowerCase().includes(search) ||
            (c.forma_pagamento || '').toLowerCase().includes(search) ||
            (c.observacoes || '').toLowerCase().includes(search));
    }
    filtered.sort((a, b) => new Date(a.data_vencimento) - new Date(b.data_vencimento));
    return filtered;
}

// ============================================
// SINCRONIZAÇÃO
// ============================================
window.sincronizarDados = async function() {
    showMessage('Sincronizando...', 'info');
    await loadContas();
    showMessage('Dados sincronizados', 'success');
};

// ============================================
// FORMULÁRIO
// ============================================
window.toggleForm = function() { window.showFormModal(null); };

window.showFormModal = function(editingId = null) {
    console.log('📝 showFormModal chamado com editingId:', editingId);
    
    const isEditing = editingId !== null && editingId !== undefined && editingId !== 'null' && editingId !== '';
    let conta = null;
    
    if (isEditing) {
        conta = contas.find(c => String(c.id || c.tempId) === String(editingId));
        if (!conta) {
            showMessage('Conta não encontrada!', 'error');
            return;
        }
        if (String(editingId).startsWith('temp_')) {
            showMessage('Aguarde a sincronização completa para editar esta conta.', 'warning');
            return;
        }
        if (conta.observacoes) {
            try {
                observacoesArray = typeof conta.observacoes === 'string' ? JSON.parse(conta.observacoes) : conta.observacoes;
            } catch (e) { observacoesArray = []; }
        } else {
            observacoesArray = [];
        }
    } else {
        observacoesArray = [];
    }

    const tituloModal = isEditing ? (conta?.descricao || 'Editar Conta') : 'Nova Conta';

    const modalHTML = `
        <div class="modal-overlay" id="formModal">
            <div class="modal-content modal-large">
                <button class="modal-close-x" onclick="window.closeFormModal()" title="Fechar">✕</button>
                <div class="modal-header"><h3 class="modal-title">${tituloModal}</h3></div>
                <form id="contaForm" onsubmit="window.handleFormSubmit(event, ${isEditing})">
                    <input type="hidden" id="observacoesData" value='${JSON.stringify(observacoesArray)}'>
                    ${isEditing ? `<input type="hidden" id="editId" value="${editingId}">` : ''}
                    <div class="tabs-container">
                        <div class="tabs-nav">
                            <button type="button" class="tab-btn active" onclick="window.switchFormTab(0)">Informações Gerais</button>
                            <button type="button" class="tab-btn" onclick="window.switchFormTab(1)">Pagamento</button>
                            <button type="button" class="tab-btn" onclick="window.switchFormTab(2)">Observações</button>
                        </div>
                        ${renderContaForm(conta)}
                    </div>
                    <div class="modal-actions">
                        <button type="submit" class="save">${isEditing ? 'Atualizar' : 'Salvar'}</button>
                        <button type="button" class="secondary" onclick="window.closeFormModal()">Cancelar</button>
                    </div>
                </form>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
    const modal = document.getElementById('formModal');
    requestAnimationFrame(() => { modal.classList.add('show'); });
    setTimeout(() => { applyUppercaseFields(); }, 100);
};

function renderContaForm(conta) {
    const observacoesHTML = observacoesArray.length > 0 ? observacoesArray.map((obs, idx) => `<div class="observacao-item" data-index="${idx}"><div class="observacao-header"><span class="observacao-data">${new Date(obs.timestamp).toLocaleString('pt-BR')}</span><button type="button" class="btn-remove-obs" onclick="window.removerObservacao(${idx})" title="Remover">✕</button></div><p class="observacao-texto">${obs.texto}</p></div>`).join('') : '<p style="color: var(--text-secondary); font-style: italic; text-align: center; padding: 2rem;">Nenhuma observação registrada</p>';

    return `
        <div class="tab-content active" id="tab-dados">
            <div class="form-grid-compact">
                <div class="form-row-descricao">
                    <div class="form-group"><label for="descricao">Descrição *</label><input type="text" id="descricao" value="${conta?.descricao || ''}" required style="text-transform:uppercase;"></div>
                    <div class="form-group"><label for="valor">Valor Inicial *</label><input type="number" id="valor" step="0.01" min="0" value="${conta?.valor || ''}" required></div>
                    <div class="form-group"><label for="data_vencimento">Data de Vencimento *</label><input type="date" id="data_vencimento" value="${conta?.data_vencimento || ''}" required></div>
                </div>
                <div class="form-row">
                    <div class="form-group"><label for="valor_pago">Valor Pago</label><input type="number" id="valor_pago" step="0.01" min="0" value="${conta?.valor_pago || ''}" placeholder="Preencha ao pagar"></div>
                    <div class="form-group"><label for="tipo_pessoa">Tipo</label><select id="tipo_pessoa"><option value="">Selecione...</option><option value="FISICA" ${conta?.tipo_pessoa === 'FISICA' ? 'selected' : ''}>Pessoa Física</option><option value="JURIDICA" ${conta?.tipo_pessoa === 'JURIDICA' ? 'selected' : ''}>Pessoa Jurídica</option></select></div>
                </div>
            </div>
        </div>
        <div class="tab-content" id="tab-pagamento">
            <div class="form-grid-compact">
                <div class="form-row">
                    <div class="form-group"><label for="forma_pagamento">Forma de Pagamento *</label><select id="forma_pagamento" required><option value="">Selecione...</option><option value="PIX" ${conta?.forma_pagamento === 'PIX' ? 'selected' : ''}>Pix</option><option value="BOLETO" ${conta?.forma_pagamento === 'BOLETO' ? 'selected' : ''}>Boleto</option><option value="CARTAO" ${conta?.forma_pagamento === 'CARTAO' ? 'selected' : ''}>Cartão</option><option value="DINHEIRO" ${conta?.forma_pagamento === 'DINHEIRO' ? 'selected' : ''}>Dinheiro</option><option value="TRANSFERENCIA" ${conta?.forma_pagamento === 'TRANSFERENCIA' ? 'selected' : ''}>Transferência</option></select></div>
                    <div class="form-group"><label for="banco">Banco *</label><select id="banco" required><option value="">Selecione...</option><option value="BANCO DO BRASIL" ${conta?.banco === 'BANCO DO BRASIL' ? 'selected' : ''}>Banco do Brasil</option><option value="BRADESCO" ${conta?.banco === 'BRADESCO' ? 'selected' : ''}>Bradesco</option><option value="SICOOB" ${conta?.banco === 'SICOOB' ? 'selected' : ''}>Sicoob</option></select></div>
                    <div class="form-group"><label for="data_pagamento">Data do Pagamento</label><input type="date" id="data_pagamento" value="${conta?.data_pagamento || ''}"></div>
                </div>
            </div>
        </div>
        <div class="tab-content" id="tab-observacoes">
            <div class="observacoes-container">
                <div class="observacoes-list" id="observacoesList">${observacoesHTML}</div>
                <div class="nova-observacao">
                    <label for="novaObservacao">Nova Observação</label>
                    <textarea id="novaObservacao" placeholder="Digite sua observação aqui..." rows="3"></textarea>
                    <button type="button" class="btn-add-obs" onclick="window.adicionarObservacao()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>Adicionar Observação</button>
                </div>
            </div>
        </div>
    `;
}

window.switchFormTab = function(index) {
    document.querySelectorAll('#formModal .tab-btn').forEach((btn, i) => { btn.classList.toggle('active', i === index); });
    document.querySelectorAll('#formModal .tab-content').forEach((content, i) => { content.classList.toggle('active', i === index); });
};

window.adicionarObservacao = function() {
    const textarea = document.getElementById('novaObservacao');
    const texto = textarea.value.trim();
    if (!texto) { showMessage('Digite uma observação primeiro', 'error'); return; }
    const observacoesDataField = document.getElementById('observacoesData');
    let observacoes = JSON.parse(observacoesDataField.value || '[]');
    observacoes.push({ texto: texto, timestamp: new Date().toISOString() });
    observacoesDataField.value = JSON.stringify(observacoes);
    textarea.value = '';
    atualizarListaObservacoes();
    showMessage('Observação adicionada!', 'success');
};

window.removerObservacao = function(index) {
    const observacoesDataField = document.getElementById('observacoesData');
    let observacoes = JSON.parse(observacoesDataField.value || '[]');
    observacoes.splice(index, 1);
    observacoesDataField.value = JSON.stringify(observacoes);
    atualizarListaObservacoes();
    showMessage('Observação removida!', 'success');
};

function atualizarListaObservacoes() {
    const observacoesDataField = document.getElementById('observacoesData');
    const observacoes = JSON.parse(observacoesDataField.value || '[]');
    const container = document.getElementById('observacoesList');
    if (observacoes.length === 0) {
        container.innerHTML = '<p style="color: var(--text-secondary); font-style: italic; text-align: center; padding: 2rem;">Nenhuma observação registrada</p>';
    } else {
        container.innerHTML = observacoes.map((obs, idx) => `<div class="observacao-item" data-index="${idx}"><div class="observacao-header"><span class="observacao-data">${new Date(obs.timestamp).toLocaleString('pt-BR')}</span><button type="button" class="btn-remove-obs" onclick="window.removerObservacao(${idx})" title="Remover">✕</button></div><p class="observacao-texto">${obs.texto}</p></div>`).join('');
    }
}

window.handleFormSubmit = function(event, isEditing) {
    event.preventDefault();
    if (isEditing) { handleEditSubmit(event); } else { handleCreateSubmit(event); }
    return false;
};

async function handleCreateSubmit(event) {
    event.preventDefault();
    await salvarContaOtimista();
}

async function handleEditSubmit(event) {
    event.preventDefault();
    const editId = document.getElementById('editId').value;
    await editarContaOtimista(editId);
}

async function salvarContaOtimista() {
    const descricao = document.getElementById('descricao')?.value?.trim();
    const valor = document.getElementById('valor')?.value;
    const dataVencimento = document.getElementById('data_vencimento')?.value;
    const formaPagamento = document.getElementById('forma_pagamento')?.value;
    const banco = document.getElementById('banco')?.value;
    const tipoPessoa = document.getElementById('tipo_pessoa')?.value || null;
    const valorPago = document.getElementById('valor_pago')?.value || null;
    const dataPagamento = document.getElementById('data_pagamento')?.value || null;
    
    if (!descricao || !valor || !dataVencimento || !formaPagamento || !banco) { 
        showMessage('Por favor, preencha todos os campos obrigatórios.', 'error'); 
        return; 
    }
    
    let status = 'PENDENTE';
    if (dataPagamento) {
        status = 'PAGO';
        if (!valorPago || parseFloat(valorPago) <= 0) {
            showMessage('Para confirmar pagamento, informe o valor pago (maior que zero).', 'error');
            return;
        }
    }
    
    const formData = {
        descricao: descricao,
        valor: parseFloat(valor),
        data_vencimento: dataVencimento,
        forma_pagamento: formaPagamento,
        banco: banco,
        tipo_pessoa: tipoPessoa,
        data_pagamento: dataPagamento,
        valor_pago: valorPago ? parseFloat(valorPago) : null,
        observacoes: document.getElementById('observacoesData')?.value || '[]',
        status: status
    };
    
    if (isNaN(formData.valor) || formData.valor <= 0) { 
        showMessage('Valor inválido. Digite um número maior que zero.', 'error'); 
        return; 
    }
    
    const tempId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const contaTemporaria = { 
        ...formData, 
        id: null, 
        tempId: tempId, 
        synced: false 
    };
    contas.push(contaTemporaria);
    lastDataHash = JSON.stringify(contas.map(c => c.id || c.tempId));
    updateAllFilters();
    updateDashboard();
    filterContas();
    window.closeFormModal();
    showMessage('Nova conta registrada localmente', 'success');
    
    if (!isOnline) { 
        showMessage('Sistema offline. A conta será sincronizada quando voltar online.', 'warning'); 
        return; 
    }
    
    addToQueue({ tempId: tempId, data: formData });
    processQueue();
}

async function editarContaOtimista(editId) {
    const descricao = document.getElementById('descricao')?.value?.trim();
    const valor = document.getElementById('valor')?.value;
    const dataVencimento = document.getElementById('data_vencimento')?.value;
    const formaPagamento = document.getElementById('forma_pagamento')?.value;
    const banco = document.getElementById('banco')?.value;
    const tipoPessoa = document.getElementById('tipo_pessoa')?.value || null;
    const valorPago = document.getElementById('valor_pago')?.value || null;
    const dataPagamento = document.getElementById('data_pagamento')?.value || null;
    
    if (!descricao || !valor || !dataVencimento || !formaPagamento || !banco) { 
        showMessage('Por favor, preencha todos os campos obrigatórios.', 'error'); 
        return; 
    }
    
    let status = 'PENDENTE';
    if (dataPagamento) {
        status = 'PAGO';
        if (!valorPago || parseFloat(valorPago) <= 0) {
            showMessage('Para confirmar pagamento, informe o valor pago (maior que zero).', 'error');
            return;
        }
    }
    
    const formData = {
        descricao: descricao,
        valor: parseFloat(valor),
        data_vencimento: dataVencimento,
        forma_pagamento: formaPagamento,
        banco: banco,
        tipo_pessoa: tipoPessoa,
        data_pagamento: dataPagamento,
        valor_pago: valorPago ? parseFloat(valorPago) : null,
        observacoes: document.getElementById('observacoesData')?.value || '[]',
        status: status
    };
    
    if (isNaN(formData.valor) || formData.valor <= 0) { 
        showMessage('Valor inválido. Digite um número maior que zero.', 'error'); 
        return; 
    }
    
    const contaOriginal = contas.find(c => String(c.id) === String(editId));
    if (!contaOriginal) { 
        showMessage('Conta não encontrada!', 'error'); 
        return; 
    }
    
    if (!isOnline) { 
        showMessage('Sistema offline. Dados não foram salvos.', 'error'); 
        window.closeFormModal(); 
        return; 
    }
    
    const backup = { ...contaOriginal };
    const index = contas.findIndex(c => String(c.id) === String(editId));
    contas[index] = { ...contaOriginal, ...formData, synced: false };
    lastDataHash = JSON.stringify(contas.map(c => c.id));
    updateAllFilters();
    updateDashboard();
    filterContas();
    window.closeFormModal();
    showMessage('Registro atualizado', 'success');
    
    try {
        const response = await fetch(`${API_URL}/contas/${editId}`, { 
            method: 'PUT', 
            headers: { 
                'Content-Type': 'application/json', 
                'X-Session-Token': sessionToken, 
                'Accept': 'application/json' 
            }, 
            body: JSON.stringify(formData), 
            mode: 'cors' 
        });
        
        if (tratarErroAutenticacao(response)) { 
            contas[index] = backup; 
            updateDashboard(); 
            filterContas(); 
            return; 
        }
        
        if (!response.ok) { 
            let errorMessage = 'Erro ao salvar'; 
            try { 
                const errorData = await response.json(); 
                errorMessage = errorData.error || errorData.message || errorMessage; 
            } catch (e) { 
                errorMessage = `Erro ${response.status}: ${response.statusText}`; 
            } 
            throw new Error(errorMessage); 
        }
        
        const savedData = await response.json();
        contas[index] = savedData;
        lastDataHash = JSON.stringify(contas.map(c => c.id));
        updateAllFilters();
        updateDashboard();
        filterContas();
    } catch (error) { 
        console.error('Erro ao sincronizar:', error); 
        contas[index] = backup; 
        updateDashboard(); 
        filterContas(); 
        showMessage(`Erro ao sincronizar: ${error.message}`, 'error'); 
    }
}

window.closeFormModal = function() {
    const modal = document.getElementById('formModal');
    if (!modal) return;
    modal.classList.remove('show');
    setTimeout(() => modal.remove(), 200);
};

function applyUppercaseFields() {
    const campo = document.getElementById('descricao');
    if (campo) campo.addEventListener('input', (e) => { const start = e.target.selectionStart; e.target.value = e.target.value.toUpperCase(); e.target.setSelectionRange(start, start); });
}

// ============================================
// TOGGLE PAGO
// ============================================
window.togglePago = async function(id) {
    const idStr = String(id);
    const conta = contas.find(c => String(c.id || c.tempId) === idStr);
    if (!conta) return;
    
    if (idStr.startsWith('temp_')) {
        showMessage('Aguarde a sincronização completa para alterar o status.', 'warning');
        return;
    }
    
    if (conta.status === 'PAGO') {
        const confirmar = confirm('Deseja desmarcar este pagamento?');
        if (!confirmar) return;
        const novoStatus = 'PENDENTE';
        const old = { status: conta.status, data: conta.data_pagamento, valor_pago: conta.valor_pago };
        conta.status = novoStatus;
        conta.data_pagamento = null;
        conta.valor_pago = null;
        updateDashboard();
        filterContas();
        showMessage('Pagamento desmarcado!', 'success');
        if (isOnline) {
            try {
                const response = await fetch(`${API_URL}/contas/${idStr}`, { 
                    method: 'PATCH', 
                    headers: { 
                        'Content-Type': 'application/json', 
                        'X-Session-Token': sessionToken, 
                        'Accept': 'application/json' 
                    }, 
                    body: JSON.stringify({ 
                        status: novoStatus, 
                        data_pagamento: null, 
                        valor_pago: null 
                    }), 
                    mode: 'cors' 
                });
                if (tratarErroAutenticacao(response)) return;
                if (!response.ok) throw new Error('Erro ao atualizar');
                const data = await response.json();
                const index = contas.findIndex(c => String(c.id) === idStr);
                if (index !== -1) contas[index] = data;
            } catch (error) { 
                conta.status = old.status; 
                conta.data_pagamento = old.data; 
                conta.valor_pago = old.valor_pago; 
                updateDashboard(); 
                filterContas(); 
                showMessage('Erro ao atualizar status', 'error'); 
            }
        }
        return;
    }
    
    const modalHTML = `
        <div class="modal-overlay" id="pagamentoModal" style="display:flex;">
            <div class="modal-content" style="max-width: 500px;">
                <button class="modal-close-x" onclick="window.closePagamentoModal()" title="Fechar">✕</button>
                <div class="modal-header"><h3 class="modal-title">Confirmar Pagamento</h3></div>
                <div class="modal-body">
                    <p style="margin-bottom: 1rem;">Informe o valor efetivamente pago para <strong>${conta.descricao}</strong></p>
                    <div class="form-group">
                        <label for="valorPagoInput">Valor Pago (R$) *</label>
                        <input type="number" id="valorPagoInput" step="0.01" min="0.01" placeholder="0,00" required>
                    </div>
                </div>
                <div class="modal-actions">
                    <button type="button" class="secondary" onclick="window.closePagamentoModal()">Cancelar</button>
                    <button type="button" class="save" onclick="window.confirmarPagamentoComValor('${idStr}')">Confirmar Pagamento</button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    document.getElementById('pagamentoModal').classList.add('show');
};

window.closePagamentoModal = function() {
    const modal = document.getElementById('pagamentoModal');
    if (modal) {
        modal.classList.remove('show');
        setTimeout(() => modal.remove(), 200);
    }
};

window.confirmarPagamentoComValor = async function(idStr) {
    const input = document.getElementById('valorPagoInput');
    const valorPago = parseFloat(input?.value);
    if (!valorPago || valorPago <= 0) {
        showMessage('Informe um valor válido (maior que zero).', 'error');
        return;
    }
    window.closePagamentoModal();
    
    const conta = contas.find(c => String(c.id) === idStr);
    if (!conta) return;
    
    const novoStatus = 'PAGO';
    const novaData = new Date().toISOString().split('T')[0];
    const old = { status: conta.status, data: conta.data_pagamento, valor_pago: conta.valor_pago };
    conta.status = novoStatus;
    conta.data_pagamento = novaData;
    conta.valor_pago = valorPago;
    updateDashboard();
    filterContas();
    showMessage(`Pagamento confirmado! Valor: R$ ${valorPago.toFixed(2)}`, 'success');
    if (isOnline) {
        try {
            const response = await fetch(`${API_URL}/contas/${idStr}`, { 
                method: 'PATCH', 
                headers: { 
                    'Content-Type': 'application/json', 
                    'X-Session-Token': sessionToken, 
                    'Accept': 'application/json' 
                }, 
                body: JSON.stringify({ 
                    status: novoStatus, 
                    data_pagamento: novaData, 
                    valor_pago: valorPago 
                }), 
                mode: 'cors' 
            });
            if (tratarErroAutenticacao(response)) return;
            if (!response.ok) throw new Error('Erro ao atualizar');
            const data = await response.json();
            const index = contas.findIndex(c => String(c.id) === idStr);
            if (index !== -1) contas[index] = data;
        } catch (error) { 
            conta.status = old.status; 
            conta.data_pagamento = old.data; 
            conta.valor_pago = old.valor_pago; 
            updateDashboard(); 
            filterContas(); 
            showMessage('Erro ao atualizar status', 'error'); 
        }
    }
};

// ============================================
// EDIÇÃO E EXCLUSÃO
// ============================================
window.editConta = function(id) {
    if (String(id).startsWith('temp_')) {
        showMessage('Aguarde a sincronização para editar esta conta.', 'warning');
        return;
    }
    window.showFormModal(id);
};

window.deleteConta = async function(id) {
    const idStr = String(id);
    const conta = contas.find(c => String(c.id || c.tempId) === idStr);
    if (!conta) return;
    
    if (idStr.startsWith('temp_')) {
        if (confirm('Tem certeza que deseja excluir esta conta (não sincronizada)?')) {
            contas = contas.filter(c => String(c.id || c.tempId) !== idStr);
            updateAllFilters();
            updateDashboard();
            filterContas();
            showMessage('Registro local excluído.', 'error');
        }
        return;
    }
    
    if (!confirm('Tem certeza que deseja excluir esta conta?')) return;
    const deleted = contas.find(c => String(c.id) === idStr);
    contas = contas.filter(c => String(c.id) !== idStr);
    updateAllFilters();
    updateDashboard();
    filterContas();
    showMessage('Registro excluído', 'error');
    if (isOnline) {
        try {
            const response = await fetch(`${API_URL}/contas/${idStr}`, { 
                method: 'DELETE', 
                headers: { 
                    'X-Session-Token': sessionToken, 
                    'Accept': 'application/json' 
                }, 
                mode: 'cors' 
            });
            if (tratarErroAutenticacao(response)) return;
            if (!response.ok) throw new Error('Erro ao deletar');
        } catch (error) { 
            if (deleted) { 
                contas.push(deleted); 
                updateAllFilters(); 
                updateDashboard(); 
                filterContas(); 
                showMessage('Erro ao excluir conta', 'error'); 
            } 
        }
    }
};

// ============================================
// REPETIR CONTA - CORRIGIDO
// ============================================
window.abrirRepetirModal = function(id) {
    const idStr = String(id);
    const conta = contas.find(c => String(c.id || c.tempId) === idStr);
    if (!conta) { showMessage('Conta não encontrada!', 'error'); return; }
    if (idStr.startsWith('temp_')) { showMessage('Aguarde a sincronização para repetir esta conta.', 'warning'); return; }

    contaParaRepetir = conta;
    mesesSelecionadosRepetir = new Set();
    calendarMode = 'repeat';
    calendarYear = currentMonth.getFullYear();

    if (typeof renderCalendar === 'function') renderCalendar();
    const modal = document.getElementById('calendarModal');
    const actions = document.getElementById('calendarActions');
    if (actions) actions.style.display = 'flex';
    if (modal) modal.classList.add('show');
};

window.confirmarRepeticao = function() {
    if (!contaParaRepetir || mesesSelecionadosRepetir.size === 0) {
        showMessage('Selecione ao menos um mês para repetir.', 'warning');
        return;
    }
    
    const original = contaParaRepetir;
    const diaOriginal = new Date(original.data_vencimento + 'T00:00:00').getDate();
    const novasContas = [];
    const novasContasData = [];

    mesesSelecionadosRepetir.forEach(key => {
        const [anoStr, mesStr] = key.split('-');
        const ano = parseInt(anoStr);
        const mes = parseInt(mesStr);
        const ultimoDiaMes = new Date(ano, mes + 1, 0).getDate();
        const dia = Math.min(diaOriginal, ultimoDiaMes);
        const dataVenc = new Date(ano, mes, dia);
        const dataVencStr = dataVenc.toISOString().split('T')[0];
        const tempId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        
        const novaConta = {
            descricao: original.descricao,
            valor: parseFloat(original.valor),
            data_vencimento: dataVencStr,
            forma_pagamento: original.forma_pagamento,
            banco: original.banco,
            tipo_pessoa: original.tipo_pessoa || null,
            data_pagamento: null,
            valor_pago: null,
            observacoes: '[]',
            status: 'PENDENTE',
            id: null,
            tempId: tempId,
            synced: false
        };
        
        contas.push({ ...novaConta });
        novasContas.push({ ...novaConta });
        
        const dataParaEnviar = { ...novaConta };
        delete dataParaEnviar.tempId;
        delete dataParaEnviar.synced;
        novasContasData.push({ tempId: tempId, data: dataParaEnviar });
    });

    lastDataHash = JSON.stringify(contas.map(c => c.id || c.tempId));
    updateAllFilters();
    updateDashboard();
    filterContas();
    showMessage(`${novasContas.length} repetição(ões) registrada(s) localmente`, 'success');
    window.cancelarRepeticao();

    if (isOnline) {
        showMessage('Sincronizando repetições...', 'info');
        novasContasData.forEach(item => addToQueue({ tempId: item.tempId, data: item.data }));
        processQueue();
    } else {
        showMessage('Sistema offline. As repetições serão sincronizadas quando voltar online.', 'warning');
    }
};

window.cancelarRepeticao = function() {
    const modal = document.getElementById('calendarModal');
    if (modal) {
        modal.classList.remove('show');
        setTimeout(() => modal.style.display = 'none', 300);
    }
    contaParaRepetir = null;
    mesesSelecionadosRepetir = new Set();
};

// ============================================
// PAINEL FINANCEIRO
// ============================================
window.abrirPainelFinanceiro = function() {
    const modal = document.getElementById('painelModal');
    if (!modal) return;
    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('show'), 10);
    atualizarPainelFinanceiro();
};

window.closePainelFinanceiro = function() {
    const modal = document.getElementById('painelModal');
    if (modal) {
        modal.classList.remove('show');
        setTimeout(() => modal.style.display = 'none', 200);
    }
};

window.changePainelYear = function(delta) {
    painelYear += delta;
    document.getElementById('painelYearDisplay').textContent = painelYear;
    atualizarPainelFinanceiro();
};

window.switchPainelTab = function(index) {
    document.querySelectorAll('#painelModal .tabs-nav .tab-btn').forEach((btn, i) => {
        btn.classList.toggle('active', i === index);
    });
    document.querySelectorAll('#painelModal .tab-content').forEach((content, i) => {
        content.classList.toggle('active', i === index);
    });
    if (index === 0) atualizarPainelAno();
    else atualizarPainelMeses();
};

function atualizarPainelFinanceiro() {
    atualizarPainelAno();
    atualizarPainelMeses();
}

function atualizarPainelAno() {
    const container = document.getElementById('painelAnoDash');
    const contasAno = contas.filter(c => {
        const data = new Date(c.data_vencimento + 'T00:00:00');
        return data.getFullYear() === painelYear;
    });
    
    const totalInicial = contasAno.reduce((s, c) => s + parseFloat(c.valor || 0), 0);
    const totalPago = contasAno.filter(c => c.status === 'PAGO').reduce((s, c) => s + parseFloat(c.valor_pago || 0), 0);
    const totalPendente = totalInicial - totalPago;
    
    container.innerHTML = `
        <div class="stat-card stat-card-warning">
            <div class="stat-icon stat-icon-warning"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg></div>
            <div class="stat-content"><div class="stat-value stat-value-warning">R$ ${totalPendente.toFixed(2)}</div><div class="stat-label">A Pagar</div></div>
        </div>
        <div class="stat-card stat-card-success">
            <div class="stat-icon stat-icon-success"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg></div>
            <div class="stat-content"><div class="stat-value stat-value-success">R$ ${totalPago.toFixed(2)}</div><div class="stat-label">Valor Total Pago</div></div>
        </div>
        <div class="stat-card">
            <div class="stat-icon stat-icon-default"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg></div>
            <div class="stat-content"><div class="stat-value">R$ ${totalInicial.toFixed(2)}</div><div class="stat-label">Valor Total Inicial</div></div>
        </div>
    `;
}

function atualizarPainelMeses() {
    const container = document.getElementById('painelMesesDash');
    const mesesAno = [];
    for (let i = 0; i < 12; i++) {
        const contasMes = contas.filter(c => {
            const data = new Date(c.data_vencimento + 'T00:00:00');
            return data.getFullYear() === painelYear && data.getMonth() === i;
        });
        const totalInicial = contasMes.reduce((s, c) => s + parseFloat(c.valor || 0), 0);
        const totalPago = contasMes.filter(c => c.status === 'PAGO').reduce((s, c) => s + parseFloat(c.valor_pago || 0), 0);
        const totalPendente = totalInicial - totalPago;
        mesesAno.push({ mes: meses[i], totalInicial, totalPago, totalPendente, count: contasMes.length });
    }
    
    container.innerHTML = mesesAno.map(m => `
        <div class="stat-card" style="flex-direction:column; align-items:flex-start; padding: 1rem;">
            <div style="font-weight:700; font-size:1rem; margin-bottom:0.5rem; color:var(--text-primary);">${m.mes}</div>
            <div style="display:flex; flex-direction:column; gap:0.25rem; width:100%;">
                <div style="display:flex; justify-content:space-between; width:100%;"><span style="color:var(--text-secondary); font-size:0.8rem;">A Pagar</span><span style="font-weight:600; color:#F59E0B;">R$ ${m.totalPendente.toFixed(2)}</span></div>
                <div style="display:flex; justify-content:space-between; width:100%;"><span style="color:var(--text-secondary); font-size:0.8rem;">Valor Total Pago</span><span style="font-weight:600; color:#22C55E;">R$ ${m.totalPago.toFixed(2)}</span></div>
                <div style="display:flex; justify-content:space-between; width:100%;"><span style="color:var(--text-secondary); font-size:0.8rem;">Valor Total Inicial</span><span style="font-weight:600; color:var(--text-primary);">R$ ${m.totalInicial.toFixed(2)}</span></div>
            </div>
        </div>
    `).join('');
}

// ============================================
// VISUALIZAÇÃO (modal com abas)
// ============================================
window.viewConta = function(id, activeTab = 'dados') {
    const idStr = String(id);
    const conta = contas.find(c => String(c.id || c.tempId) === idStr);
    if (!conta) { showMessage('Conta não encontrada!', 'error'); return; }

    const tipoPessoaLabel = conta.tipo_pessoa === 'FISICA' ? 'Pessoa Física' : (conta.tipo_pessoa === 'JURIDICA' ? 'Pessoa Jurídica' : '-');

    const dadosHTML = `
        <div class="info-grid">
            <div class="info-item info-item-full"><span class="info-label">Descrição:</span><span class="info-value">${conta.descricao}</span></div>
            <div class="info-item"><span class="info-label">Valor Inicial:</span><span class="info-value info-highlight">R$ ${parseFloat(conta.valor).toFixed(2)}</span></div>
            <div class="info-item"><span class="info-label">Valor Pago:</span><span class="info-value">${conta.valor_pago ? 'R$ ' + parseFloat(conta.valor_pago).toFixed(2) : '-'}</span></div>
            <div class="info-item"><span class="info-label">Vencimento:</span><span class="info-value">${formatDate(conta.data_vencimento)}</span></div>
            <div class="info-item"><span class="info-label">Forma de Pagamento:</span><span class="info-value">${conta.forma_pagamento}</span></div>
            <div class="info-item"><span class="info-label">Banco:</span><span class="info-value">${conta.banco}</span></div>
            <div class="info-item"><span class="info-label">${conta.data_pagamento ? 'Data do Pagamento:' : 'Status:'}</span><span class="info-value">${conta.data_pagamento ? formatDate(conta.data_pagamento) : 'Não pago'}</span></div>
            <div class="info-item"><span class="info-label">Tipo:</span><span class="info-value">${tipoPessoaLabel}</span></div>
        </div>
    `;

    let observacoesHTML = '';
    if (conta.observacoes) {
        try {
            const obsArray = typeof conta.observacoes === 'string' ? JSON.parse(conta.observacoes) : conta.observacoes;
            if (obsArray.length > 0) {
                observacoesHTML = obsArray.map(o => `
                    <div class="observacao-item">
                        <div class="observacao-header">
                            <span class="observacao-data">${new Date(o.timestamp).toLocaleString('pt-BR')}</span>
                        </div>
                        <p class="observacao-texto">${o.texto}</p>
                    </div>
                `).join('');
            } else {
                observacoesHTML = '<p style="color: var(--text-secondary); font-style: italic; text-align: center; padding: 2rem;">Nenhuma observação registrada</p>';
            }
        } catch(e) {
            observacoesHTML = `<p style="color: var(--text-secondary);">${conta.observacoes}</p>`;
        }
    } else {
        observacoesHTML = '<p style="color: var(--text-secondary); font-style: italic; text-align: center; padding: 2rem;">Nenhuma observação registrada</p>';
    }

    const observacoesContainer = `
        <div class="observacoes-container" style="padding: 0;">
            <div class="observacoes-list" style="max-height: 400px; overflow-y: auto; padding: 0; background: transparent; border: none;">
                ${observacoesHTML}
            </div>
        </div>
    `;

    const modalHTML = `
        <div class="modal-overlay" id="viewModal">
            <div class="modal-content modal-view">
                <button class="modal-close-x" onclick="window.closeViewModal()" title="Fechar">✕</button>
                <div class="modal-header">
                    <h3 class="modal-title">${conta.descricao}</h3>
                </div>
                <div class="tabs-container">
                    <div class="tabs-nav">
                        <button type="button" class="tab-btn ${activeTab === 'dados' ? 'active' : ''}" onclick="window.switchViewTab(0)">Dados Gerais</button>
                        <button type="button" class="tab-btn ${activeTab === 'observacoes' ? 'active' : ''}" onclick="window.switchViewTab(1)">Observações</button>
                    </div>
                    <div class="tab-content ${activeTab === 'dados' ? 'active' : ''}" id="viewTabDados">
                        ${dadosHTML}
                    </div>
                    <div class="tab-content ${activeTab === 'observacoes' ? 'active' : ''}" id="viewTabObservacoes">
                        ${observacoesContainer}
                    </div>
                </div>
                <div class="modal-actions">
                    <button class="secondary" onclick="window.closeViewModal()">Fechar</button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
    const modalEl = document.getElementById('viewModal');
    modalEl.style.display = 'flex';
    setTimeout(() => modalEl.classList.add('show'), 10);
};

window.switchViewTab = function(index) {
    const modal = document.getElementById('viewModal');
    if (!modal) return;
    const tabs = modal.querySelectorAll('.tabs-nav .tab-btn');
    const contents = modal.querySelectorAll('.tab-content');
    tabs.forEach((btn, i) => btn.classList.toggle('active', i === index));
    contents.forEach((content, i) => content.classList.toggle('active', i === index));
};

window.closeViewModal = function() {
    const modal = document.getElementById('viewModal');
    if (modal) {
        modal.classList.remove('show');
        setTimeout(() => modal.remove(), 300);
    }
};

// ============================================
// FILTROS E RENDERIZAÇÃO DA TABELA
// ============================================
function updateAllFilters() {
    const bancos = new Set();
    contas.forEach(c => { if (c.banco?.trim()) bancos.add(c.banco.trim()); });
    const select = document.getElementById('filterBanco');
    if (select) { const val = select.value; select.innerHTML = '<option value="">Todos</option>'; Array.from(bancos).sort().forEach(b => { const opt = document.createElement('option'); opt.value = b; opt.textContent = b; select.appendChild(opt); }); select.value = val; }
    const selectPag = document.getElementById('filterPagamento');
    if (selectPag) { const val = selectPag.value; const formas = new Set(); contas.forEach(c => { if (c.forma_pagamento?.trim()) formas.add(c.forma_pagamento.trim()); }); selectPag.innerHTML = '<option value="">Todas Formas</option>'; Array.from(formas).sort().forEach(f => { const opt = document.createElement('option'); opt.value = f; opt.textContent = f; selectPag.appendChild(opt); }); selectPag.value = val; }
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const contasDoMes = contas.filter(c => { const dataVenc = new Date(c.data_vencimento + 'T00:00:00'); return dataVenc.getMonth() === currentMonth.getMonth() && dataVenc.getFullYear() === currentMonth.getFullYear(); });
    let temVencido = false, temPago = false, temPendente = false;
    contasDoMes.forEach(c => { if (c.status === 'PAGO') { temPago = true; } else { const dataVenc = new Date(c.data_vencimento + 'T00:00:00'); dataVenc.setHours(0, 0, 0, 0); if (dataVenc <= hoje) { temVencido = true; } else { temPendente = true; } } });
    const statusSelect = document.getElementById('filterStatus');
    if (statusSelect) { const val = statusSelect.value; statusSelect.innerHTML = '<option value="">Todos</option>'; if (temPago) statusSelect.innerHTML += '<option value="PAGO">Pago</option>'; if (temVencido) statusSelect.innerHTML += '<option value="VENCIDO">Vencido</option>'; if (temPendente) statusSelect.innerHTML += '<option value="PENDENTE">Pendente</option>'; statusSelect.value = val; }
}

function filterContas() {
    const search = (document.getElementById('search')?.value || '').toLowerCase();
    const banco = document.getElementById('filterBanco')?.value || '';
    const status = document.getElementById('filterStatus')?.value || '';
    const pagamento = document.getElementById('filterPagamento')?.value || '';
    let filtered = contas.filter(c => { const dataVenc = new Date(c.data_vencimento + 'T00:00:00'); return dataVenc.getMonth() === currentMonth.getMonth() && dataVenc.getFullYear() === currentMonth.getFullYear(); });
    if (banco) filtered = filtered.filter(c => c.banco === banco);
    if (pagamento) filtered = filtered.filter(c => c.forma_pagamento === pagamento);
    if (status) { const hoje = new Date(); hoje.setHours(0, 0, 0, 0); filtered = filtered.filter(c => { if (status === 'PAGO') return c.status === 'PAGO'; if (status === 'VENCIDO') { if (c.status === 'PAGO') return false; const dataVenc = new Date(c.data_vencimento + 'T00:00:00'); dataVenc.setHours(0, 0, 0, 0); return dataVenc <= hoje; } if (status === 'PENDENTE') { if (c.status === 'PAGO') return false; const dataVenc = new Date(c.data_vencimento + 'T00:00:00'); dataVenc.setHours(0, 0, 0, 0); return dataVenc > hoje; } return true; }); }
    if (search) filtered = filtered.filter(c => (c.descricao || '').toLowerCase().includes(search) || (c.banco || '').toLowerCase().includes(search) || (c.forma_pagamento || '').toLowerCase().includes(search) || (c.observacoes || '').toLowerCase().includes(search));
    filtered.sort((a, b) => new Date(a.data_vencimento) - new Date(b.data_vencimento));
    renderContas(filtered);
}

function renderContas(lista) {
    const container = document.getElementById('contasContainer');
    if (!container) return;
    if (!lista || lista.length === 0) { 
        container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-secondary)">Nenhuma conta encontrada para este período</div>'; 
        return; 
    }
    
    const table = `<table>
        <thead>
            <tr>
                <th style="text-align:center;width:60px;"><span style="font-size:1.1rem;">✓</span></th>
                <th>Descrição</th>
                <th>Valor Inicial</th>
                <th>Valor Pago</th>
                <th>Vencimento</th>
                <th>Banco</th>
                <th>Forma de PG</th>
                <th>Data Pagamento</th>
                <th style="text-align:center;width:60px;"></th>
                <th style="text-align:center;">Ações</th>
            </tr>
        </thead>
        <tbody>
            ${lista.map(c => { 
                const isPago = c.status === 'PAGO'; 
                const contaId = c.id || c.tempId;

                let temObservacao = false;
                if (c.observacoes) {
                    try {
                        const obsArray = typeof c.observacoes === 'string' ? JSON.parse(c.observacoes) : c.observacoes;
                        if (obsArray.length > 0) temObservacao = true;
                    } catch(e) {}
                }

                const alertIcon = temObservacao 
                    ? `<button class="action-btn alert-icon" data-action="view-obs" data-id="${contaId}" title="Ver observações">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                            <line x1="12" y1="9" x2="12" y2="13" />
                            <line x1="12" y1="17" x2="12.01" y2="17" />
                        </svg>
                       </button>`
                    : '';

                const formaPagamentoDisplay = c.forma_pagamento || '-';
                const podeRepetir = c.id && !String(contaId).startsWith('temp_');

                return `<tr data-conta-id="${contaId}" class="${isPago ? 'row-pago' : ''}">
                    <td style="text-align:center;padding:8px;"><button class="check-btn ${isPago ? 'checked' : ''}" data-action="toggle" data-id="${contaId}"></button></td>
                    <td>${c.descricao}</td>
                    <td><strong>R$ ${parseFloat(c.valor).toFixed(2)}</strong></td>
                    <td>${c.valor_pago ? 'R$ ' + parseFloat(c.valor_pago).toFixed(2) : '-'}</td>
                    <td style="white-space:nowrap;">${formatDate(c.data_vencimento)}</td>
                    <td>${c.banco || '-'}</td>
                    <td>${formaPagamentoDisplay}</td>
                    <td style="white-space:nowrap;">${c.data_pagamento ? formatDate(c.data_pagamento) : '-'}</td>
                    <td style="text-align:center;">${alertIcon}</td>
                    <td class="actions-cell">
                        ${podeRepetir ? `<button class="action-btn repeat" data-action="repeat" data-id="${contaId}">Repetir</button>` : ''}
                        <button class="action-btn edit" data-action="edit" data-id="${contaId}">Editar</button>
                        <button class="action-btn delete" data-action="delete" data-id="${contaId}">Excluir</button>
                    </td>
                 </tr>`;
            }).join('')}
        </tbody>
    </table>`;
    container.innerHTML = table;
}

// ============================================
// UTILITÁRIOS
// ============================================
function formatDate(dateString) { if (!dateString) return '-'; return new Date(dateString + 'T00:00:00').toLocaleDateString('pt-BR'); }
function getStatusDinamico(conta) { if (conta.status === 'PAGO') return 'PAGO'; const hoje = new Date(); hoje.setHours(0, 0, 0, 0); const dataVenc = new Date(conta.data_vencimento + 'T00:00:00'); dataVenc.setHours(0, 0, 0, 0); if (dataVenc <= hoje) return 'VENCIDO'; return 'PENDENTE'; }
function getStatusBadge(status) { const map = { 'PAGO': { class: 'pago', text: 'Pago' }, 'VENCIDO': { class: 'vencido', text: 'Vencido' }, 'PENDENTE': { class: 'pendente', text: 'Pendente' } }; const s = map[status] || { class: 'pendente', text: status }; return `<span class="badge ${s.class}">${s.text}</span>`; }
function showMessage(message, type) { const old = document.querySelectorAll('.floating-message'); old.forEach(m => m.remove()); const div = document.createElement('div'); div.className = `floating-message ${type}`; div.textContent = message; document.body.appendChild(div); setTimeout(() => { div.style.animation = 'slideOut 0.3s ease forwards'; setTimeout(() => div.remove(), 300); }, 3000); }
function generateUUID() { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) { const r = Math.random() * 16 | 0; const v = c === 'x' ? r : (r & 0x3 | 0x8); return v.toString(16); }); }
