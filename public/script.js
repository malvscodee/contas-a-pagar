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

let formType = 'simple';
let numParcelas = 0;
let currentGrupoId = null;
let parcelasDoGrupo = [];
let observacoesArray = [];
let tentativasReconexao = 0;
const MAX_TENTATIVAS = 3;

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
        const response = await fetch(`${API_URL}/contas`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Session-Token': sessionToken,
                'Accept': 'application/json'
            },
            body: JSON.stringify(item.data),
            mode: 'cors'
        });

        if (tratarErroAutenticacao(response)) {
            item.status = 'auth_error';
            return;
        }

        if (response.ok) {
            const savedData = await response.json();
            const index = contas.findIndex(c => c.tempId === item.tempId);
            if (index !== -1) contas[index] = savedData;
            item.status = 'success';
            console.log(`✅ Parcela ${item.tempId} salva com sucesso`);
            updateAllFilters();
            updateDashboard();
            filterContas();
        } else {
            throw new Error(`Erro ${response.status}`);
        }
    } catch (error) {
        console.error(`❌ Erro ao processar item ${item.tempId}:`, error);
        item.attempts++;
        
        if (item.attempts >= processingQueue.retryAttempts) {
            item.status = 'failed';
            showMessage(`Falha ao salvar parcela. Tente novamente.`, 'error');
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

async function loadParcelasDoGrupo(grupoId) {
    if (!isOnline || !grupoId) return [];

    try {
        const response = await fetch(`${API_URL}/contas/grupo/${grupoId}`, {
            method: 'GET',
            headers: { 
                'X-Session-Token': sessionToken,
                'Accept': 'application/json'
            },
            mode: 'cors'
        });

        if (tratarErroAutenticacao(response)) return [];
        if (!response.ok) return [];

        const data = await response.json();
        return data || [];
    } catch (error) {
        console.error('❌ Erro ao carregar parcelas do grupo:', error);
        return [];
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
        .reduce((sum, c) => sum + parseFloat(c.valor || 0), 0);
    
    const contasVencidas = contasDoMes.filter(c => {
        if (c.status === 'PAGO') return false;
        const dataVenc = new Date(c.data_vencimento + 'T00:00:00');
        dataVenc.setHours(0, 0, 0, 0);
        return dataVenc <= hoje;
    });
    const qtdVencido = contasVencidas.length;
    
    const valorTotal = contasDoMes.reduce((sum, c) => sum + parseFloat(c.valor || 0), 0);
    const valorPendente = valorTotal - valorPago;
    
    document.getElementById('statPagos').textContent = `R$ ${valorPago.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
    document.getElementById('statVencido').textContent = qtdVencido;
    document.getElementById('statPendente').textContent = `R$ ${valorPendente.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
    document.getElementById('statValorTotal').textContent = `R$ ${valorTotal.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
    
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
    
    const contasDoMes = contas.filter(c => {
        const dataVenc = new Date(c.data_vencimento + 'T00:00:00');
        return dataVenc.getMonth() === currentMonth.getMonth() && dataVenc.getFullYear() === currentMonth.getFullYear();
    });
    
    const contasVencidas = contasDoMes.filter(c => {
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
                <tr><th>Descrição</th><th>Vencimento</th><th style="text-align:right;">Valor</th><th style="text-align:center;">Dias Atraso</th></tr>
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
        let parcelaDisplay = '-';
        if (c.parcela_numero && c.parcela_total) {
            parcelaDisplay = `${c.parcela_numero}/${c.parcela_total}`;
        }
        return [
            c.descricao,
            parcelaDisplay,
            `R$ ${parseFloat(c.valor).toFixed(2)}`,
            formatDate(c.data_vencimento),
            c.banco || '-',
            c.data_pagamento ? formatDate(c.data_pagamento) : '-'
        ];
    });
    
    doc.autoTable({
        startY: 48,
        head: [['Descrição', 'Parcela', 'Valor (R$)', 'Vencimento', 'Banco', 'Data Pagamento']],
        body: tableData,
        theme: 'striped',
        headStyles: { fillColor: [100, 100, 100], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
        styles: { fontSize: 9, cellPadding: 3, valign: 'middle' },
        columnStyles: {
            0: { cellWidth: 'auto', lineWidth: 0.2 },
            1: { halign: 'center', cellWidth: 20 },
            2: { halign: 'right', cellWidth: 25 },
            3: { halign: 'center', cellWidth: 22 },
            4: { halign: 'left', cellWidth: 28 },
            5: { halign: 'center', cellWidth: 25 }
        },
        margin: { left: 14, right: 14 }
    });
    
    const totalPago = filtrados.filter(c => c.status === 'PAGO').reduce((s, c) => s + parseFloat(c.valor), 0);
    const totalPendente = filtrados.filter(c => c.status !== 'PAGO').reduce((s, c) => s + parseFloat(c.valor), 0);
    const totalGeral = totalPago + totalPendente;
    const finalY = doc.lastAutoTable.finalY + 10;
    
    doc.setFontSize(10);
    doc.setFont(undefined, 'bold');
    doc.text(`Total Pago: R$ ${totalPago.toFixed(2)}`, 14, finalY);
    doc.text(`Total Pendente: R$ ${totalPendente.toFixed(2)}`, 80, finalY);
    doc.text(`Total Geral: R$ ${totalGeral.toFixed(2)}`, 160, finalY);
    
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

window.showFormModal = async function(editingId = null) {
    console.log('📝 showFormModal chamado com editingId:', editingId);
    
    const isEditing = editingId !== null && editingId !== undefined && editingId !== 'null' && editingId !== '';
    let conta = null;
    let isPagamentoFixo = false;
    
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
        if (conta.grupo_id) {
            currentGrupoId = conta.grupo_id;
            parcelasDoGrupo = await loadParcelasDoGrupo(conta.grupo_id);
        } else {
            currentGrupoId = null;
            parcelasDoGrupo = [conta];
        }
        if (conta.observacoes) {
            try {
                observacoesArray = typeof conta.observacoes === 'string' ? JSON.parse(conta.observacoes) : conta.observacoes;
            } catch (e) { observacoesArray = []; }
        } else {
            observacoesArray = [];
        }
        isPagamentoFixo = conta.pagamento_fixo || false;
    } else {
        currentGrupoId = null;
        parcelasDoGrupo = [];
        observacoesArray = [];
        isPagamentoFixo = false;
    }

    formType = isEditing ? 'edit' : 'simple';
    numParcelas = 0;

    const temParcelas = isEditing && conta?.grupo_id && parcelasDoGrupo.length > 1;
    
    const modalHTML = `
        <div class="modal-overlay" id="formModal">
            <div class="modal-content modal-large">
                <button class="modal-close-x" onclick="window.closeFormModal()" title="Fechar">✕</button>
                <div class="modal-header"><h3 class="modal-title">${isEditing ? 'Editar Conta' : 'Nova Conta'}</h3></div>
                ${!isEditing ? `<div class="form-type-selector"><button type="button" class="form-type-btn active" onclick="window.selectFormType('simple')">Simples</button><button type="button" class="form-type-btn" onclick="window.selectFormType('parcelado')">Parcelado</button></div>` : ''}
                <form id="contaForm" onsubmit="window.handleFormSubmit(event, ${isEditing})">
                    <input type="hidden" id="observacoesData" value='${JSON.stringify(observacoesArray)}'>
                    ${isEditing ? `<input type="hidden" id="editId" value="${editingId}"><input type="hidden" id="grupoId" value="${currentGrupoId || ''}">` : ''}
                    <div class="tabs-container">
                        <div class="tabs-nav">
                            ${isEditing && temParcelas ? `<button type="button" class="tab-btn active" onclick="window.switchFormTab(0)">Dados Gerais</button>${parcelasDoGrupo.map((p, idx) => `<button type="button" class="tab-btn" onclick="window.switchFormTab(${idx + 1})">${p.parcela_numero}ª Parcela</button>`).join('')}<button type="button" class="tab-btn" onclick="window.switchFormTab(${parcelasDoGrupo.length + 1})">Observações</button>` : `<button type="button" class="tab-btn active" onclick="window.switchFormTab(0)">Dados</button><button type="button" class="tab-btn" onclick="window.switchFormTab(1)">Pagamento</button><button type="button" class="tab-btn" onclick="window.switchFormTab(2)">Observações</button>`}
                        </div>
                        ${isEditing && temParcelas ? renderEditFormComParcelas(conta) : renderEditFormSimples(conta, isEditing, isPagamentoFixo)}
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

function renderEditFormSimples(conta, isEditing, isPagamentoFixo) {
    const observacoesHTML = observacoesArray.length > 0 ? observacoesArray.map((obs, idx) => `<div class="observacao-item" data-index="${idx}"><div class="observacao-header"><span class="observacao-data">${new Date(obs.timestamp).toLocaleString('pt-BR')}</span><button type="button" class="btn-remove-obs" onclick="window.removerObservacao(${idx})" title="Remover">✕</button></div><p class="observacao-texto">${obs.texto}</p></div>`).join('') : '<p style="color: var(--text-secondary); font-style: italic; text-align: center; padding: 2rem;">Nenhuma observação registrada</p>';
    
    const pagamentoFixoChecked = isPagamentoFixo || (conta?.pagamento_fixo || false);
    
    return `
        <div class="tab-content active" id="tab-dados">
            <div class="form-grid-compact">
                <div class="form-row">
                    <div class="form-group form-group-full"><label for="descricao">Descrição *</label><input type="text" id="descricao" value="${conta?.descricao || ''}" required style="text-transform:uppercase;"></div>
                </div>
                <div id="formSimple" ${formType === 'parcelado' ? 'style="display:none"' : ''}>
                    <div class="form-row">
                        <div class="form-group"><label for="valor">Valor (R$) *</label><input type="number" id="valor" step="0.01" min="0" value="${conta?.valor || ''}" ${formType === 'simple' ? 'required' : ''}></div>
                        <div class="form-group"><label for="data_vencimento">Data de Vencimento *</label><input type="date" id="data_vencimento" value="${conta?.data_vencimento || ''}" ${formType === 'simple' ? 'required' : ''}></div>
                    </div>
                    <div class="form-row">
                        <div class="form-group" style="display:flex;align-items:center;gap:0.5rem;">
                            <label for="pagamentoFixo" style="margin-bottom:0;cursor:pointer;">Pagamento Fixo</label>
                            <button type="button" id="pagamentoFixoBtn" class="pagamento-fixo-btn ${pagamentoFixoChecked ? 'active' : ''}" onclick="window.togglePagamentoFixo()" style="flex:1;padding:12px 16px;border:2px solid var(--border-color);border-radius:8px;background:var(--input-bg);color:var(--text-primary);font-size:0.95rem;font-weight:500;cursor:pointer;transition:all 0.3s ease;text-align:center;">
                                ${pagamentoFixoChecked ? '✅ Ativo' : 'Inativo'}
                            </button>
                        </div>
                    </div>
                </div>
                <div id="formParcelado" ${formType !== 'parcelado' ? 'style="display:none"' : ''}>
                    <div class="form-row">
                        <div class="form-group"><label for="numParcelas">Número de Parcelas *</label><input type="number" id="numParcelas" min="2" max="360" onchange="window.generateParcelas()"></div>
                        <div class="form-group"><label for="valorTotal">Valor Total (R$) *</label><input type="number" id="valorTotal" step="0.01" min="0" onchange="window.generateParcelas()"></div>
                        <div class="form-group"><label for="dataInicio">Data Início *</label><input type="date" id="dataInicio" onchange="window.generateParcelas()"></div>
                    </div>
                    <div id="parcelasContainer"></div>
                </div>
            </div>
        </div>
        <div class="tab-content" id="tab-pagamento">
            <div class="form-grid-compact">
                <div class="form-row">
                    <div class="form-group"><label for="forma_pagamento">Forma de Pagamento *</label><select id="forma_pagamento" ${formType === 'simple' ? 'required' : ''}><option value="">Selecione...</option><option value="PIX" ${conta?.forma_pagamento === 'PIX' ? 'selected' : ''}>Pix</option><option value="BOLETO" ${conta?.forma_pagamento === 'BOLETO' ? 'selected' : ''}>Boleto</option><option value="CARTAO" ${conta?.forma_pagamento === 'CARTAO' ? 'selected' : ''}>Cartão</option><option value="DINHEIRO" ${conta?.forma_pagamento === 'DINHEIRO' ? 'selected' : ''}>Dinheiro</option><option value="TRANSFERENCIA" ${conta?.forma_pagamento === 'TRANSFERENCIA' ? 'selected' : ''}>Transferência</option></select></div>
                    <div class="form-group"><label for="banco">Banco *</label><select id="banco" ${formType === 'simple' ? 'required' : ''}><option value="">Selecione...</option><option value="BANCO DO BRASIL" ${conta?.banco === 'BANCO DO BRASIL' ? 'selected' : ''}>Banco do Brasil</option><option value="BRADESCO" ${conta?.banco === 'BRADESCO' ? 'selected' : ''}>Bradesco</option><option value="SICOOB" ${conta?.banco === 'SICOOB' ? 'selected' : ''}>Sicoob</option></select></div>
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
                    <button type="button" class="btn-add-obs" onclick="window.adicionarObservacao()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="
