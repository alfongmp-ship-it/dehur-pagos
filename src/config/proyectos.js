export const PROYECTOS_SEED = [
  {id:'paraiso', nombre:'Privada del Paraíso', empresa:'Desarrollo de Hogares Urbanos SA de CV',
   cuenta:'0124913019', clabe:'012180001249130198', color:'#c8a96e', activo:true},
  {id:'entorno', nombre:'Entorno', empresa:'Dehur Territorial SA de CV',
   cuenta:'0111221051', clabe:'012180001112210514', color:'#5a9be0', activo:true},
  {id:'dt', nombre:'Concentradora DT', empresa:'Dehur Territorial SA de CV',
   cuenta:'0122903652', clabe:'012180001229036526', color:'#4caf7d', activo:true},
];

export function loadProyectos() {
  return JSON.parse(localStorage.getItem('dt_proyectos') || 'null') || JSON.parse(JSON.stringify(PROYECTOS_SEED));
}

export function saveProy(proyectos) {
  try { localStorage.setItem('dt_proyectos', JSON.stringify(proyectos)); } catch(e) {}
}
