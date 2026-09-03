// ============================================
// CALENDAR.JS - CONTAS A PAGAR
// ============================================

let calendarYear = new Date().getFullYear();

const mesesNomes = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

// Abrir/fechar modal de calendário (modo navegação)
window.toggleCalendar = function() {
    const modal = document.getElementById('calendarModal');
    const actions = document.getElementById('calendarActions');
    if (!modal) return;

    if (modal.classList.contains('show')) {
        modal.classList.remove('show');
        calendarMode = 'navigate';
        if (actions) actions.style.display = 'none';
    } else {
        calendarMode = 'navigate';
        calendarYear = currentMonth.getFullYear();
        if (actions) actions.style.display = 'none';
        renderCalendar();
        modal.classList.add('show');
    }
};

// Cancelar seleção de repetição e fechar modal
window.cancelarRepeticao = function() {
    calendarMode = 'navigate';
    mesesSelecionadosRepetir = new Set();
    contaParaRepetir = null;
    const modal = document.getElementById('calendarModal');
    const actions = document.getElementById('calendarActions');
    if (actions) actions.style.display = 'none';
    if (modal) modal.classList.remove('show');
};

// Mudar o ano no calendário
window.changeCalendarYear = function(direction) {
    calendarYear += direction;
    document.getElementById('calendarYear').textContent = calendarYear;
    renderCalendar();
};

// Renderizar os meses do calendário
function renderCalendar() {
    const yearElement = document.getElementById('calendarYear');
    const monthsContainer = document.getElementById('calendarMonths');

    if (!yearElement || !monthsContainer) return;

    yearElement.textContent = calendarYear;

    monthsContainer.innerHTML = '';

    mesesNomes.forEach((nome, index) => {
        const monthButton = document.createElement('div');
        monthButton.className = 'calendar-month';
        monthButton.textContent = nome;

        if (typeof calendarMode !== 'undefined' && calendarMode === 'repeat') {
            const key = `${calendarYear}-${index}`;
            if (typeof mesesSelecionadosRepetir !== 'undefined' && mesesSelecionadosRepetir.has(key)) {
                monthButton.classList.add('selected');
            }
            monthButton.onclick = () => toggleMesRepeticao(index);
        } else {
            if (calendarYear === currentMonth.getFullYear() && index === currentMonth.getMonth()) {
                monthButton.classList.add('current');
            }
            monthButton.onclick = () => selectMonth(index);
        }

        monthsContainer.appendChild(monthButton);
    });
}

// Alternar seleção de mês no modo repetição
function toggleMesRepeticao(monthIndex) {
    const key = `${calendarYear}-${monthIndex}`;
    if (mesesSelecionadosRepetir.has(key)) {
        mesesSelecionadosRepetir.delete(key);
    } else {
        mesesSelecionadosRepetir.add(key);
    }
    renderCalendar();
}

// Selecionar um mês (modo navegação)
function selectMonth(monthIndex) {
    if (typeof currentMonth !== 'undefined') {
        currentMonth = new Date(calendarYear, monthIndex, 1);
    }

    // Atualizar a interface principal
    if (typeof updateDisplay === 'function') {
        updateDisplay();
    }

    // Recarregar os dados
    if (typeof loadContas === 'function') {
        loadContas();
    }

    // Fechar o modal
    window.toggleCalendar();
}

// Fechar modal ao clicar fora
document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('calendarModal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                if (typeof calendarMode !== 'undefined' && calendarMode === 'repeat') {
                    window.cancelarRepeticao();
                } else {
                    modal.classList.remove('show');
                }
            }
        });
    }
});
