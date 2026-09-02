// ============================================
// CALENDAR.JS - CONTAS A PAGAR
// ============================================

let calendarYear = new Date().getFullYear();

const mesesNomes = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

// Abrir/fechar modal de calendário
window.toggleCalendar = function() {
    const modal = document.getElementById('calendarModal');
    if (!modal) return;

    if (modal.classList.contains('show')) {
        modal.classList.remove('show');
    } else {
        calendarYear = currentMonth.getFullYear();
        renderCalendar();
        modal.classList.add('show');
    }
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

        // Marcar mês atual
        if (calendarYear === currentMonth.getFullYear() && index === currentMonth.getMonth()) {
            monthButton.classList.add('current');
        }

        monthButton.onclick = () => selectMonth(index);
        monthsContainer.appendChild(monthButton);
    });
}

// Selecionar um mês
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
                modal.classList.remove('show');
            }
        });
    }
});
