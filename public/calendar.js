let calendarYear = new Date().getFullYear();

function toggleCalendar() {
    const modal = document.getElementById('calendarModal');
    if (!modal) return;
    if (modal.classList.contains('show')) {
        modal.classList.remove('show');
        setTimeout(() => modal.style.display = 'none', 200);
        return;
    }
    calendarYear = currentMonth.getFullYear();
    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('show'), 10);
    renderCalendar();
}

function renderCalendar() {
    document.getElementById('calendarYear').textContent = calendarYear;
    const container = document.getElementById('calendarMonths');
    container.innerHTML = '';
    const currentMonthNum = currentMonth.getMonth();
    const currentYear = currentMonth.getFullYear();
    
    for (let i = 0; i < 12; i++) {
        const div = document.createElement('div');
        div.className = 'calendar-month';
        if (i === currentMonthNum && calendarYear === currentYear) {
            div.classList.add('current');
        }
        if (mesesSelecionadosRepetir && calendarMode === 'repeat') {
            const key = `${calendarYear}-${i}`;
            if (mesesSelecionadosRepetir.has(key)) {
                div.classList.add('selected');
            }
        }
        div.textContent = meses[i];
        div.dataset.month = i;
        div.addEventListener('click', function() {
            const month = parseInt(this.dataset.month);
            if (calendarMode === 'repeat') {
                const key = `${calendarYear}-${month}`;
                if (mesesSelecionadosRepetir.has(key)) {
                    mesesSelecionadosRepetir.delete(key);
                    this.classList.remove('selected');
                } else {
                    mesesSelecionadosRepetir.add(key);
                    this.classList.add('selected');
                }
            } else {
                currentMonth.setMonth(month);
                currentMonth.setFullYear(calendarYear);
                updateDisplay();
                document.getElementById('calendarModal').classList.remove('show');
                setTimeout(() => document.getElementById('calendarModal').style.display = 'none', 200);
            }
        });
        container.appendChild(div);
    }
}

window.changeCalendarYear = function(delta) {
    calendarYear += delta;
    renderCalendar();
};

window.toggleCalendar = toggleCalendar;
window.renderCalendar = renderCalendar;

window.cancelarRepeticao = function() {
    calendarMode = 'navigate';
    mesesSelecionadosRepetir = new Set();
    contaParaRepetir = null;
    const modal = document.getElementById('calendarModal');
    const actions = document.getElementById('calendarActions');
    if (actions) actions.style.display = 'none';
    if (modal) {
        modal.classList.remove('show');
        setTimeout(() => modal.style.display = 'none', 200);
    }
};
