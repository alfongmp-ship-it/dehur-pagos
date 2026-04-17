// Bank codes map (CLABE prefix -> bank name)
export const BANCOS = {"002":"Banamex","006":"Bancomext","012":"BBVA","014":"Santander","021":"HSBC","030":"Bajio","036":"Inbursa","042":"Mifel","044":"Scotiabank","058":"Banregio","059":"Invex","072":"Banorte","112":"Santander","124":"Citibanamex","127":"Azteca","128":"Autofin","137":"Bancoppel","143":"CIBanco","646":"STP","653":"Kuspit"};

export function getBanco(c) {
  return c && c.length >= 3 ? BANCOS[c.substring(0, 3)] || `Banco(${c.substring(0, 3)})` : 'BBVA';
}

export function getTipo(c) {
  if (c.length === 18) return 'CLABE';
  return 'Cuenta';
}
