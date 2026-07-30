const useColor = process.stdout.isTTY && !process.env.NO_COLOR;

function ansi(code, value) {
  return useColor ? `\u001B[${code}m${value}\u001B[0m` : value;
}

export const ui = {
  bold: (value) => ansi('1', value),
  dim: (value) => ansi('2', value),
  cyan: (value) => ansi('38;5;45', value),
  green: (value) => ansi('38;5;84', value),
  yellow: (value) => ansi('38;5;221', value),
  red: (value) => ansi('38;5;203', value),
};

export function printHeader(version) {
  console.log('');
  console.log(`  ${ui.cyan('◆')} ${ui.bold('MICRODEX')} ${ui.dim(`v${version}`)}`);
  console.log(`    ${ui.dim('Codex, from your phone.')}`);
  console.log('');
}

export function printCheck(label, detail = '') {
  const suffix = detail ? `  ${ui.dim(detail)}` : '';
  console.log(`  ${ui.green('✓')} ${label}${suffix}`);
}

export function printWarning(label, detail = '') {
  const suffix = detail ? `  ${ui.dim(detail)}` : '';
  console.log(`  ${ui.yellow('!')} ${label}${suffix}`);
}

export function printFailure(label, detail = '') {
  const suffix = detail ? `  ${ui.dim(detail)}` : '';
  console.log(`  ${ui.red('×')} ${label}${suffix}`);
}

export function printStep(number, label, detail = '') {
  console.log(`  ${ui.cyan(String(number).padStart(2, '0'))}  ${ui.bold(label)}`);
  if (detail) console.log(`      ${ui.dim(detail)}`);
}

export function printQr(value, qrcode) {
  qrcode.generate(value, { small: true }, (qr) => {
    const lines = qr.trimEnd().split('\n');
    console.log('');
    for (const line of lines) console.log(`      ${line}`);
    console.log('');
  });
}
