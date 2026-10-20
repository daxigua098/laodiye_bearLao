// Shared pack split calculator. Arithmetic only: 24 bottles divided by selected headcount.
(() => {
  document.querySelectorAll('[data-calc]').forEach((calc) => {
    const output = calc.querySelector('[data-bottles]');
    const summary = calc.querySelector('[data-calc-summary]');
    const buttons = [...calc.querySelectorAll('[data-people]')];
    if (!output || !buttons.length) return;

    const update = (button) => {
      const people = Number(button.dataset.people);
      const bottles = 24 / people;
      buttons.forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
      output.textContent = Number.isInteger(bottles) ? String(bottles) : bottles.toFixed(1);
      if (summary) summary.textContent = `${people} 人分一箱，每人约 ${output.textContent} 瓶`;
    };

    buttons.forEach((button) => button.addEventListener('click', () => update(button)));
    update(buttons.find((button) => button.getAttribute('aria-pressed') === 'true') || buttons[0]);
  });
})();
