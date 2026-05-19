// Mapa de proyecto -> imagen del plano del desarrollo.
// La imagen se commitea en assets/planos/. Cuando el usuario entregue un plano,
// se agrega aquí la entrada con la ruta del archivo.
//
// Ejemplo:
//   'Privada del Paraíso': { img: './assets/planos/paraiso.jpg' },
export const PLANOS = {
  'Privada del Paraíso': { img: './assets/planos/paraiso.png' },
};

// Devuelve la config de plano de un proyecto, o null si aún no tiene.
export function planoDeProyecto(nombre) {
  return PLANOS[nombre] || null;
}
