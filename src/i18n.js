// -----------------------------------------------------------------------------
// Runtime texts shown in Gladys. Every text is a { en, fr } object.
// -----------------------------------------------------------------------------

export const T = {
  noToken: {
    en: 'No Tibber access token: paste it in the configuration (developer.tibber.com).',
    fr: 'Aucun jeton Tibber : collez-le dans la configuration (developer.tibber.com).',
  },
  badToken: {
    en: 'Tibber refused the access token: not tried again until you save the configuration (create a new token on developer.tibber.com if needed).',
    fr: "Tibber a refusé le jeton : plus d'essai tant que la configuration n'est pas enregistrée (créez un nouveau jeton sur developer.tibber.com si besoin).",
  },
  paused: (until) => ({
    en: `Tibber asked to slow down (429): no call before ${new Date(until).toISOString().slice(11, 16)} UTC.`,
    fr: `Tibber a demandé de ralentir (429) : aucun appel avant ${new Date(until).toISOString().slice(11, 16)} UTC.`,
  }),
  noHome: {
    en: 'The Tibber account has no home with an active subscription.',
    fr: "Le compte Tibber n'a aucune maison avec un abonnement actif.",
  },
  ok: (homes, live, oldGladys = false) => ({
    en: `Connected: ${homes} home${homes > 1 ? 's' : ''}${live ? `, live power on ${live}` : ''}.${oldGladys ? ' The consumption is not sent to the energy monitoring: it needs Gladys 5.2.0 or later.' : ''}`,
    fr: `Connecté : ${homes} maison${homes > 1 ? 's' : ''}${live ? `, puissance en direct sur ${live}` : ''}.${oldGladys ? " La consommation n'est pas envoyée au suivi énergétique : il faut Gladys 5.2.0 ou plus récent." : ''}`,
  }),
  unreachable: (message) => ({
    en: `Tibber is unreachable: ${message}. Retrying at the next refresh.`,
    fr: `Tibber est injoignable : ${message}. Nouvel essai au prochain rafraîchissement.`,
  }),
  level: {
    VERY_CHEAP: { en: 'Very cheap', fr: 'Très bon marché' },
    CHEAP: { en: 'Cheap', fr: 'Bon marché' },
    NORMAL: { en: 'Normal', fr: 'Normal' },
    EXPENSIVE: { en: 'Expensive', fr: 'Cher' },
    VERY_EXPENSIVE: { en: 'Very expensive', fr: 'Très cher' },
  },
  widget: {
    now: { en: 'Now', fr: 'Maintenant' },
    next: { en: 'Next', fr: 'Ensuite' },
    today: { en: 'Today avg.', fr: 'Moy. du jour' },
    tomorrow: { en: 'Tomorrow avg.', fr: 'Moy. de demain' },
    levelRow: { en: 'Price level', fr: 'Niveau de prix' },
    cheapest: (hours) => ({ en: `Cheapest ${hours} h`, fr: `${hours} h les moins chères` }),
    tomorrowRow: { en: "Tomorrow's prices", fr: 'Prix de demain' },
    published: { en: 'Published', fr: 'Publiés' },
    notYet: { en: 'Not yet (around 13:00)', fr: 'Pas encore (vers 13 h)' },
    chart: { en: 'Price per kWh', fr: 'Prix par kWh' },
    noData: {
      en: 'No price yet: the integration reads Tibber every hour.',
      fr: "Pas encore de prix : l'intégration lit Tibber toutes les heures.",
    },
    noHome: {
      en: 'Pick a home in the widget settings',
      fr: 'Choisissez une maison dans les réglages du widget',
    },
    power: { en: 'Power', fr: 'Puissance' },
    production: { en: 'Production', fr: 'Production' },
    todayKwh: { en: 'Today', fr: "Aujourd'hui" },
    todayCost: { en: 'Cost today', fr: 'Coût du jour' },
    yesterdayKwh: { en: 'Yesterday', fr: 'Hier' },
    peak: { en: 'Peak today', fr: 'Pic du jour' },
    average: { en: 'Average today', fr: 'Moyenne du jour' },
    voltage: { en: 'Voltage', fr: 'Tension' },
    current: { en: 'Current', fr: 'Courant' },
    signal: { en: 'Pulse signal', fr: 'Signal du Pulse' },
    noLive: {
      en: 'No live measurement yet (a Tibber Pulse or Watty is needed).',
      fr: 'Pas encore de mesure en direct (un Tibber Pulse ou Watty est nécessaire).',
    },
    liveOff: {
      en: 'Live power is disabled in the configuration.',
      fr: 'La puissance en direct est désactivée dans la configuration.',
    },
  },
};
