const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

// Render the real page with read-only fixtures: no authentication or database writes.
let lines = [];
const baseLine = {
  employeeId: 1, employeeName: 'Fixture', role: 'Test', daysWorked: 20,
  gross: 1000, deductions: 100, paidAmount: 900, carryoverAmount: 0,
  socialInsurance: 0, incomeTax: 0, taxRelief: 0, advanceAmount: 0,
  manualDeduction: 0, paymentDate: null, secondPaymentDate: null,
};
const money = (value = 0) => `${new Intl.NumberFormat('mn-MN', { maximumFractionDigits: 0 }).format(value)} ₮`;
const query = (data) => ({ data, isLoading: false, isError: false });
const mutation = () => ({ isPending: false, mutate() {} });
const api = {
  useGetPayroll: () => query({ month: '2026-09', lines }),
  useGetPayrollAdvance: () => query({ lines: [], approved: false }),
  useListCashClosures: () => query([]),
  useGetAuthSession: () => query({ role: 'admin' }),
};
const stub = (props) => React.createElement('div', null, props.children);
const source = fs.readFileSync(path.join(__dirname, 'Payroll.tsx'), 'utf8');
const compiled = ts.transpileModule(source, {
  reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
});
assert.equal(compiled.diagnostics.length, 0);
const pageModule = { exports: {} };
vm.runInNewContext(compiled.outputText, {
  module: pageModule, exports: pageModule.exports, console,
  require(id) {
    if (id === 'react') return {
      ...React, useEffect() {}, useRef: (value) => ({ current: value }),
      useState: (value) => [value, () => {}],
    };
    if (id === 'react/jsx-runtime') return require('react/jsx-runtime');
    if (id === '@workspace/api-client-react') return new Proxy(api, {
      get: (object, key) => key in object ? object[key] : mutation,
    });
    if (id === '@tanstack/react-query') return { useQueryClient: () => ({ invalidateQueries() {} }) };
    if (id === 'react-hook-form') return { useForm: () => ({}) };
    if (id === '@/lib/utils') return { cn: (...args) => args.filter(Boolean).join(' ') };
    if (id === '@/lib/app-shared') return {
      money, currentMonth: () => '2026-09', today: () => '2026-09-30', dateLabel: (date) => date,
    };
    if (id === '@/hooks/useQueueDeletion') return { useQueueDeletion: mutation };
    return new Proxy({}, { get: () => stub });
  },
});
const render = (fixtures) => {
  lines = fixtures.map((line, index) => ({ ...baseLine, employeeId: index + 1, ...line }));
  return renderToStaticMarkup(React.createElement(pageModule.exports.Payroll));
};
const remainingCell = (html, testId = 'value-payroll-total-remaining') =>
  html.match(new RegExp(`<td[^>]*data-testid="${testId}"[^>]*>([^<]*)</td>`))[1];

test('footer adds signed row balances including carryover without changing other totals', () => {
  const html = render([
    { paidAmount: 800 }, { paidAmount: 950 },
    { carryoverAmount: 30 }, { carryoverAmount: -20 },
  ]);
  assert.equal(remainingCell(html), money(60));
  assert.equal(remainingCell(html, 'value-payroll-remaining-1'), money(100));
  assert.equal(remainingCell(html, 'value-payroll-remaining-2'), `(${money(50)})`);
  assert.equal(remainingCell(html, 'value-payroll-total-payable'), money(3600));
  assert.equal(remainingCell(html, 'value-payroll-total-paid'), money(3550));
});

test('zeroes each row within one tugrik before summing', () => {
  const html = render([{ paidAmount: 899 }, { paidAmount: 899 }, { paidAmount: 901 }]);
  assert.equal(remainingCell(html), money(0));
  for (const id of [1, 2, 3]) {
    assert.equal(remainingCell(html, `value-payroll-remaining-${id}`), money(0));
  }
});

test('updated data replaces the total and negative totals retain row formatting', () => {
  assert.equal(remainingCell(render([{ paidAmount: 800 }])), money(100));
  assert.equal(remainingCell(render([{ paidAmount: 1000 }])), `(${money(100)})`);
  assert.equal(remainingCell(render([{ paidAmount: 900 }])), money(0));
});

test('remaining total occupies column 15 in the 16-column footer; empty data has no stale total', () => {
  const html = render([{}]);
  const footer = html.match(/<tfoot[\s\S]*?<\/tfoot>/)[0];
  let column = 1;
  for (const cell of footer.matchAll(/<td([^>]*)>[\s\S]*?<\/td>/g)) {
    if (cell[1].includes('value-payroll-total-remaining')) assert.equal(column, 15);
    column += Number(cell[1].match(/colSpan="(\d+)"/i)?.[1] ?? 1);
  }
  assert.equal(column, 17);
  assert.doesNotMatch(render([]), /value-payroll-total-remaining/);
});
