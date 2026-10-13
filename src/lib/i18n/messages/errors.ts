export const errors = {
  "es-MX": {
    PREFERENCES_CONFLICT:
      "Tus preferencias cambiaron en otra sesión. Consultamos la versión actual; revisa y vuelve a elegir tu cambio.",
    PREFERENCES_INVALID: "Revisa las preferencias indicadas.",
    COMMUNICATIONS_UNAVAILABLE:
      "Las comunicaciones opcionales no están disponibles hasta contar con autorización legal vigente.",
    unavailable:
      "No pudimos guardar tus preferencias. Se conserva la última configuración confirmada; puedes reintentar.",
    session: "Tu sesión venció. Inicia sesión de nuevo.",
    organization:
      "No pudimos crear la organización. Revisa el nombre o intenta más tarde.",
  },
  "en-US": {
    PREFERENCES_CONFLICT:
      "Your preferences changed in another session. We loaded the current version; review it and choose your change again.",
    PREFERENCES_INVALID: "Review the indicated preferences.",
    COMMUNICATIONS_UNAVAILABLE:
      "Optional communications are unavailable until valid legal authorization is in place.",
    unavailable:
      "We couldn't save your preferences. Your last confirmed settings remain active; you can retry.",
    session: "Your session expired. Sign in again.",
    organization:
      "We couldn't create the organization. Review the name or try later.",
  },
} as const;
