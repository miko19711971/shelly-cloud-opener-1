// index.js — Guest Assistant (Via Leonina 71) — Multilingual + Native Voices

import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('.')); // static (logo, favicon)

// ---------------- Base ----------------
const base = {
  apartment_id: 'LEONINA71',
  name: 'Via Leonina 71',
  address: 'Via Leonina 71, Rome, Italy',
  checkin_time: '15:00',
  checkout_time: '11:00',
  host_phone: '+39 335 5245756',
  apt_label: { en:'Apartment', it:'Appartamento', fr:'Appartement', de:'Apartment', es:'Apartamento' }
};

// ---------------- Contenuti localizzati ----------------
const APT_I18N = {
  en: {
    // Wi-Fi
    wifi_note: 'Router on the table. Turn it around to see SSID & password on the label.',
    wifi_ssid: 'See router label',
    wifi_password: 'See router label',

    // Water / AC / Bathroom / Towels / Lighting
    water_note: 'Tap water is safe to drink. Hot water is always available. Important: do NOT touch the switch on the left side of the bathroom mirror (it controls the hot water system).',
    ac_note: 'Air conditioning is available. Please turn it OFF when you leave the apartment.',
    bathroom_amenities: 'Hairdryer, bath mat, toilet paper, hand soap.',
    towels_note: 'Per guest: 1 large + 1 medium + 1 small towel. Beds are prepared on arrival.',
    lighting_note: 'Kitchen lights: switch on the right side of the stairs (facing the kitchen). Terrace lights: switch inside on the right before exiting to the terrace.',

    // Kitchen / Safety devices (electric)
    kitchen_note: 'Kitchen is fully equipped. Electric hot plate: ALWAYS switch it off after use and never leave pots/pans unattended.',

    // Terrace / Safety
    terrace_note: 'If you open the terrace umbrella, TIE it to the railing. Always close and untie it before leaving the apartment.',
    plants_note: 'If you like, you may water the plants once a day (except cacti).',

    // Building & Access
    front_door_access: 'Use the long key with the square end; pull the heavy door toward you and turn the key counter-clockwise to open.',
    building_code: '7171 + key symbol',
    intercom_note: '—',

    // Services nearby
    supermarkets: 'Carrefour Express (Via Urbana) • Mini-markets on Via Leonina.',
    pharmacies: 'Farmacia Cavour (Via Cavour 84) • Pharmacy on Via Panisperna 40.',
    atms: 'BNL ATM (Via Cavour 84) • UniCredit ATM (Piazza della Suburra 5).',
    laundry: 'Wash & Dry Laundromat — Via Cavour 194 (self-service).',
    luggage: 'Radical Storage locations around Termini and Largo Argentina (book online).',
    sims: 'Iliad — Via Cavour 196 • TIM/Vodafone — Via Nazionale.',

    // Transport
    transport: 'Metro B — Cavour station (≈5 min walk). Bus lines 75, 117, 84 on Via Cavour. Walking is ideal around Monti.',
    airports: 'Fiumicino: Metro B Cavour → Termini → Leonardo Express (≈32 min) or FL1 from Trastevere. Ciampino: bus to Termini → Metro B Cavour. Private transfer: Welcome Pickups.',
    taxi: 'Radio Taxi +39 06 3570 or FreeNow app.',

    // Safety & useful numbers
    emergency: 'EU Emergency 112 • Police 113 • Ambulance 118 • Fire 115 • English-speaking doctor +39 06 488 2371 • 24h vet +39 06 660 681',

    // Eat / Drink / Shop
    eat: 'La Carbonara • Ai Tre Scalini • Trattoria Vecchia Roma • Fafiuche Wine Bar • Al42 by Pasta Chef Monti • Broccoletti • Cuoco e Camicia.',
    drink: 'VinoRoma Wine Studio • La Bottega del Caffè (Piazza Madonna dei Monti) • Spritzeria Monti • Blackmarket Hall.',
    shop: 'Mercato Monti Vintage Market (Via Leonina 46, weekends) • Via Urbana & Via del Boschetto boutiques • Panisperna Libreria • Artisan leather & design stores in Monti.',

    // Visit / Hidden gems
    visit: 'Piazza Madonna dei Monti • Santa Maria ai Monti • San Martino ai Monti • San Pietro in Vincoli (Michelangelo’s Moses) • Colle Oppio Park & Domus Aurea • Trajan’s Market & Forum.',
    hidden_gems: 'Sotterranei di San Martino ai Monti (guided tours) • Basilica di Santa Prassede (Chapel of St. Zeno) • Scalinata dei Borgia • Ancient Suburra streets (Via Cavour/Leonina/Panisperna) • Roman houses beneath Santa Pudenziana.',

    // Experiences
    experiences: 'Aperitivo in Piazza Madonna dei Monti • Vintage browsing at Mercato Monti (weekends) • Rooftop/terrace photos at sunset • Stroll Via Urbana & Via dei Serpenti • Evening walk past the Roman Forum and Piazza Venezia.',
    romantic_walk: 'Start: Via Leonina 71 → Colosseum → Arch of Constantine → Via dei Fori Imperiali → Piazza del Campidoglio → Fatamorgana Monti gelato → La Bottega del Caffè → back to Via Leonina 71.',

    // Check-in / Check-out
    checkin_access: 'Front door: {front_door_access}. Building: code {building_code} (alternative to round key).',
    checkout_note: 'Before leaving: turn off lights/AC, close windows, leave keys on the table, gently close the door.'
  },

  it: {
    wifi_note: 'Router sul tavolo. Giralo per vedere SSID e password sull’etichetta.',
    wifi_ssid: 'Vedi etichetta del router',
    wifi_password: 'Vedi etichetta del router',
    water_note: 'L’acqua del rubinetto è potabile. L’acqua calda è sempre disponibile. Importante: NON toccare l’interruttore a sinistra dello specchio del bagno (controlla l’acqua calda).',
    ac_note: 'Aria condizionata disponibile. Spegnila quando esci dall’appartamento.',
    bathroom_amenities: 'Asciugacapelli, tappetino, carta igienica, sapone per le mani.',
    towels_note: 'Per ospite: 1 asciugamano grande + 1 medio + 1 piccolo. I letti sono pronti all’arrivo.',
    lighting_note: 'Luci cucina: interruttore a destra delle scale (fronte cucina). Luci terrazzo: interruttore interno a destra prima di uscire.',
    kitchen_note: 'Cucina completamente attrezzata. Piastra elettrica: spegnerla SEMPRE dopo l’uso e non lasciare mai pentole/padelle incustodite.',
    terrace_note: 'Se apri l’ombrellone del terrazzo, LEGALO alla ringhiera. Chiudilo e scioglilo sempre prima di uscire.',
    plants_note: 'Se vuoi, annaffia le piante una volta al giorno (tranne i cactus).',
    front_door_access: 'Usa la chiave lunga con testa quadrata; tira la porta pesante verso di te e gira la chiave in senso antiorario per aprire.',
    building_code: '7171 + simbolo chiave',
    intercom_note: '—',
    supermarkets: 'Carrefour Express (Via Urbana) • Minimarket su Via Leonina.',
    pharmacies: 'Farmacia Cavour (Via Cavour 84) • Farmacia in Via Panisperna 40.',
    atms: 'BNL (Via Cavour 84) • UniCredit (Piazza della Suburra 5).',
    laundry: 'Wash & Dry — Via Cavour 194 (self-service).',
    luggage: 'Punti Radical Storage tra Termini e Largo Argentina (prenota online).',
    sims: 'Iliad — Via Cavour 196 • TIM/Vodafone — Via Nazionale.',
    transport: 'Metro B — Cavour (≈5 min a piedi). Bus 75, 117, 84 su Via Cavour. A piedi è l’ideale nel rione Monti.',
    airports: 'Fiumicino: Metro B Cavour → Termini → Leonardo Express (≈32 min) o FL1 da Trastevere. Ciampino: bus per Termini → Metro B Cavour. Transfer privato: Welcome Pickups.',
    taxi: 'Radio Taxi +39 06 3570 o app FreeNow.',
    emergency: 'Emergenze UE 112 • Polizia 113 • Ambulanza 118 • Vigili del Fuoco 115 • Medico in inglese +39 06 488 2371 • Veterinario 24h +39 06 660 681',
    eat: 'La Carbonara • Ai Tre Scalini • Trattoria Vecchia Roma • Fafiuche Wine Bar • Al42 by Pasta Chef Monti • Broccoletti • Cuoco e Camicia.',
    drink: 'VinoRoma Wine Studio • La Bottega del Caffè (Piazza Madonna dei Monti) • Spritzeria Monti • Blackmarket Hall.',
    shop: 'Mercato Monti Vintage (Via Leonina 46, weekend) • Boutique di Via Urbana & Via del Boschetto • Panisperna Libreria • Artigiani pelle & design a Monti.',
    visit: 'Piazza Madonna dei Monti • Santa Maria ai Monti • San Martino ai Monti • San Pietro in Vincoli (Mosè di Michelangelo) • Parco del Colle Oppio & Domus Aurea • Mercati e Foro di Traiano.',
    hidden_gems: 'Sotterranei di San Martino ai Monti (visite guidate) • Basilica di Santa Prassede (Cappella di San Zenone) • Scalinata dei Borgia • Antiche vie della Suburra (Via Cavour/Leonina/Panisperna) • Case romane sotto Santa Pudenziana.',
    experiences: 'Aperitivo in Piazza Madonna dei Monti • Vintage al Mercato Monti (weekend) • Foto al tramonto su rooftop/terrazzo • Passeggiata in Via Urbana & Via dei Serpenti • Sera tra Foro Romano e Piazza Venezia.',
    romantic_walk: 'Partenza: Via Leonina 71 → Colosseo → Arco di Costantino → Via dei Fori Imperiali → Piazza del Campidoglio → gelato da Fatamorgana Monti → La Bottega del Caffè → ritorno a Via Leonina 71.',
    checkin_access: 'Portone: {front_door_access}. Edificio: codice {building_code} (alternativa alla chiave rotonda).',
    checkout_note: 'Prima di partire: spegni luci/AC, chiudi le finestre, lascia le chiavi sul tavolo, chiudi la porta delicatamente.'
  },

  fr: {
    wifi_note: 'Routeur sur la table. Tournez-le pour voir le SSID et le mot de passe sur l’étiquette.',
    wifi_ssid: 'Voir l’étiquette du routeur',
    wifi_password: 'Voir l’étiquette du routeur',
    water_note: 'L’eau du robinet est potable. L’eau chaude est toujours disponible. Important : ne touchez PAS l’interrupteur à gauche du miroir de la salle de bain (il contrôle l’eau chaude).',
    ac_note: 'Climatisation disponible. Merci de l’éteindre en quittant l’appartement.',
    bathroom_amenities: 'Sèche-cheveux, tapis de bain, papier toilette, savon pour les mains.',
    towels_note: 'Par personne : 1 grande + 1 moyenne + 1 petite serviette. Les lits sont prêts à l’arrivée.',
    lighting_note: 'Lumières cuisine : interrupteur à droite des escaliers (face cuisine). Lumières terrasse : interrupteur intérieur à droite avant la porte.',
    kitchen_note: 'Cuisine entièrement équipée. Plaque électrique : ÉTEIGNEZ-LA TOUJOURS après usage et ne laissez jamais les casseroles sans surveillance.',
    terrace_note: 'Si vous ouvrez le parasol de la terrasse, ATTACHEZ-LE à la rambarde. Fermez-le et détachez-le toujours avant de sortir.',
    plants_note: 'Si vous le souhaitez, arrosez les plantes une fois par jour (sauf les cactus).',
    front_door_access: 'Utilisez la longue clé carrée ; tirez la porte vers vous et tournez la clé dans le sens inverse des aiguilles d’une montre pour ouvrir.',
    building_code: '7171 + symbole clé',
    intercom_note: '—',
    supermarkets: 'Carrefour Express (Via Urbana) • Épiceries sur Via Leonina.',
    pharmacies: 'Farmacia Cavour (Via Cavour 84) • Pharmacie Via Panisperna 40.',
    atms: 'BNL (Via Cavour 84) • UniCredit (Piazza della Suburra 5).',
    laundry: 'Laverie Wash & Dry — Via Cavour 194 (self-service).',
    luggage: 'Points Radical Storage autour de Termini et Largo Argentina (réservation en ligne).',
    sims: 'Iliad — Via Cavour 196 • TIM/Vodafone — Via Nazionale.',
    transport: 'Métro B — station Cavour (≈5 min). Bus 75, 117, 84 sur Via Cavour. À pied, idéal dans Monti.',
    airports: 'Fiumicino : Métro B Cavour → Termini → Leonardo Express (≈32 min) ou FL1 depuis Trastevere. Ciampino : bus pour Termini → Métro B Cavour. Transfert privé : Welcome Pickups.',
    taxi: 'Radio Taxi +39 06 3570 ou application FreeNow.',
    emergency: 'Urgences UE 112 • Police 113 • Ambulance 118 • Pompiers 115 • Médecin anglophone +39 06 488 2371 • Vétérinaire 24h/24 +39 06 660 681',
    eat: 'La Carbonara • Ai Tre Scalini • Trattoria Vecchia Roma • Fafiuche Wine Bar • Al42 by Pasta Chef Monti • Broccoletti • Cuoco e Camicia.',
    drink: 'VinoRoma Wine Studio • La Bottega del Caffè (Piazza Madonna dei Monti) • Spritzeria Monti • Blackmarket Hall.',
    shop: 'Mercato Monti Vintage (Via Leonina 46, week-end) • Boutiques Via Urbana & Via del Boschetto • Panisperna Libreria • Artisans cuir & design à Monti.',
    visit: 'Piazza Madonna dei Monti • Santa Maria ai Monti • San Martino ai Monti • San Pietro in Vincoli (Moïse de Michel-Ange) • Parc Colle Oppio & Domus Aurea • Marchés & Forum de Trajan.',
    hidden_gems: 'Souterrains de San Martino ai Monti (visites guidées) • Basilique Santa Prassede (chapelle Saint-Zénon) • Escalier des Borgia • Vieilles rues de la Suburra (Via Cavour/Leonina/Panisperna) • Maisons romaines sous Santa Pudenziana.',
    experiences: 'Apéritif Piazza Madonna dei Monti • Vintage au Mercato Monti (week-end) • Photos au coucher du soleil sur rooftop/terrasse • Balade Via Urbana & Via dei Serpenti • Soirée autour du Forum romain et Piazza Venezia.',
    romantic_walk: 'Départ : Via Leonina 71 → Colisée → Arc de Constantin → Via dei Fori Imperiali → Piazza del Campidoglio → glace Fatamorgana Monti → La Bottega del Caffè → retour Via Leonina 71.',
    checkin_access: 'Arrivée : {front_door_access}. Immeuble : code {building_code} (alternative à la clé ronde).',
    checkout_note: 'Avant de partir : éteignez lumières/AC, fermez les fenêtres, laissez les clés sur la table, fermez la porte délicatement.'
  },

  de: {
    wifi_note: 'Router auf dem Tisch. Umdrehen, um SSID & Passwort auf dem Etikett zu sehen.',
    wifi_ssid: 'Siehe Router-Etikett',
    wifi_password: 'Siehe Router-Etikett',
    water_note: 'Leitungswasser ist trinkbar. Warmwasser ist immer verfügbar. Wichtig: den Schalter links am Badezimmerspiegel NICHT betätigen (steuert das Warmwasser).',
    ac_note: 'Klimaanlage vorhanden. Bitte ausschalten, wenn Sie die Wohnung verlassen.',
    bathroom_amenities: 'Haartrockner, Badematte, Toilettenpapier, Handseife.',
    towels_note: 'Pro Gast: 1 großes + 1 mittleres + 1 kleines Handtuch. Betten bei Ankunft gemacht.',
    lighting_note: 'Küchenlicht: Schalter rechts neben der Treppe (zur Küche gewandt). Terrassenlicht: Schalter innen rechts vor der Tür.',
    kitchen_note: 'Küche voll ausgestattet. Elektrische Kochplatte: IMMER nach Gebrauch ausschalten, Töpfe/Pfannen nie unbeaufsichtigt lassen.',
    terrace_note: 'Wenn Sie den Terrassenschirm öffnen, binden Sie ihn am Geländer fest. Vor dem Verlassen immer schließen und lösen.',
    plants_note: 'Bei Bedarf Pflanzen einmal täglich gießen (außer Kakteen).',
    front_door_access: 'Langer Schlüssel mit quadratischem Kopf; Tür zu sich ziehen und Schlüssel gegen den Uhrzeigersinn drehen.',
    building_code: '7171 + Schlüssel-Symbol',
    intercom_note: '—',
    supermarkets: 'Carrefour Express (Via Urbana) • Mini-Märkte in der Via Leonina.',
    pharmacies: 'Farmacia Cavour (Via Cavour 84) • Apotheke Via Panisperna 40.',
    atms: 'BNL (Via Cavour 84) • UniCredit (Piazza della Suburra 5).',
    laundry: 'Waschsalon Wash & Dry — Via Cavour 194 (self-service).',
    luggage: 'Radical Storage in der Umgebung von Termini & Largo Argentina (online buchen).',
    sims: 'Iliad — Via Cavour 196 • TIM/Vodafone — Via Nazionale.',
    transport: 'Metro B — Station Cavour (≈5 Min). Bus 75, 117, 84 in der Via Cavour. Zu Fuß ideal im Viertel Monti.',
    airports: 'Fiumicino: Metro B Cavour → Termini → Leonardo Express (≈32 Min) oder FL1 ab Trastevere. Ciampino: Bus nach Termini → Metro B Cavour. Privattransfer: Welcome Pickups.',
    taxi: 'Radio Taxi +39 06 3570 oder FreeNow-App.',
    emergency: 'EU-Notruf 112 • Polizei 113 • Rettung 118 • Feuerwehr 115 • Englischsprachiger Arzt +39 06 488 2371 • Tierarzt 24h +39 06 660 681',
    eat: 'La Carbonara • Ai Tre Scalini • Trattoria Vecchia Roma • Fafiuche Wine Bar • Al42 by Pasta Chef Monti • Broccoletti • Cuoco e Camicia.',
    drink: 'VinoRoma Wine Studio • La Bottega del Caffè (Piazza Madonna dei Monti) • Spritzeria Monti • Blackmarket Hall.',
    shop: 'Mercato Monti Vintage (Via Leonina 46, Wochenenden) • Boutiquen Via Urbana & Via del Boschetto • Panisperna Libreria • Kunsthandwerk Leder & Design in Monti.',
    visit: 'Piazza Madonna dei Monti • Santa Maria ai Monti • San Martino ai Monti • San Pietro in Vincoli (Moses von Michelangelo) • Colle Oppio Park & Domus Aurea • Trajansmärkte & Forum.',
    hidden_gems: 'Untergrund von San Martino ai Monti (Führungen) • Basilika Santa Prassede (Zenon-Kapelle) • Borgia-Treppe • Alte Suburra-Straßen (Via Cavour/Leonina/Panisperna) • Römische Häuser unter Santa Pudenziana.',
    experiences: 'Aperitivo auf der Piazza Madonna dei Monti • Vintage-Stöbern im Mercato Monti (Wochenende) • Fotos zum Sonnenuntergang auf Rooftop/Terrasse • Spaziergang Via Urbana & Via dei Serpenti • Abends am Forum Romanum und Piazza Venezia.',
    romantic_walk: 'Start: Via Leonina 71 → Kolosseum → Konstantinsbogen → Via dei Fori Imperiali → Piazza del Campidoglio → Eis bei Fatamorgana Monti → La Bottega del Caffè → zurück Via Leonina 71.',
    checkin_access: 'Zugang: {front_door_access}. Gebäude: Code {building_code} (Alternative zum Rundschlüssel).',
    checkout_note: 'Vor der Abreise: Licht/AC aus, Fenster schließen, Schlüssel auf dem Tisch lassen, Tür sanft schließen.'
  },

  es: {
    wifi_note: 'Router en la mesa. Gíralo para ver SSID y contraseña en la etiqueta.',
    wifi_ssid: 'Ver etiqueta del router',
    wifi_password: 'Ver etiqueta del router',
    water_note: 'El agua del grifo es potable. El agua caliente está siempre disponible. Importante: NO toques el interruptor a la izquierda del espejo del baño (controla el agua caliente).',
    ac_note: 'Hay aire acondicionado. Por favor, apágalo al salir del apartamento.',
    bathroom_amenities: 'Secador, alfombrilla, papel higiénico, jabón de manos.',
    towels_note: 'Por huésped: 1 toalla grande + 1 mediana + 1 pequeña. Las camas están preparadas a la llegada.',
    lighting_note: 'Luces cocina: interruptor a la derecha de las escaleras (frente a la cocina). Luces terraza: interruptor interior a la derecha antes de salir.',
    kitchen_note: 'Cocina completamente equipada. Placa eléctrica: APÁGALA SIEMPRE después de usar y nunca dejes ollas/sartenes desatendidas.',
    terrace_note: 'Si abres la sombrilla de la terraza, ÁTALA a la barandilla. Ciérrala y desátala siempre antes de salir.',
    plants_note: 'Si quieres, riega las plantas una vez al día (excepto cactus).',
    front_door_access: 'Usa la llave larga con extremo cuadrado; tira de la puerta hacia ti y gira la llave en sentido antihorario para abrir.',
    building_code: '7171 + símbolo de llave',
    intercom_note: '—',
    supermarkets: 'Carrefour Express (Via Urbana) • Mini-mercados en Via Leonina.',
    pharmacies: 'Farmacia Cavour (Via Cavour 84) • Farmacia en Via Panisperna 40.',
    atms: 'BNL (Via Cavour 84) • UniCredit (Piazza della Suburra 5).',
    laundry: 'Wash & Dry — Via Cavour 194 (autoservicio).',
    luggage: 'Puntos Radical Storage cerca de Termini y Largo Argentina (reserva online).',
    sims: 'Iliad — Via Cavour 196 • TIM/Vodafone — Via Nazionale.',
    transport: 'Metro B — estación Cavour (≈5 min). Buses 75, 117, 84 en Via Cavour. Caminar es ideal por Monti.',
    airports: 'Fiumicino: Metro B Cavour → Termini → Leonardo Express (≈32 min) o FL1 desde Trastevere. Ciampino: bus a Termini → Metro B Cavour. Traslado privado: Welcome Pickups.',
    taxi: 'Radio Taxi +39 06 3570 o app FreeNow.',
    emergency: 'Emergencia UE 112 • Policía 113 • Ambulancia 118 • Bomberos 115 • Médico en inglés +39 06 488 2371 • Veterinario 24h +39 06 660 681',
    eat: 'La Carbonara • Ai Tre Scalini • Trattoria Vecchia Roma • Fafiuche Wine Bar • Al42 by Pasta Chef Monti • Broccoletti • Cuoco e Camicia.',
    drink: 'VinoRoma Wine Studio • La Bottega del Caffè (Piazza Madonna dei Monti) • Spritzeria Monti • Blackmarket Hall.',
    shop: 'Mercato Monti Vintage (Via Leonina 46, fines de semana) • Boutiques Via Urbana & Via del Boschetto • Panisperna Libreria • Artesanos de cuero y diseño en Monti.',
    visit: 'Piazza Madonna dei Monti • Santa Maria ai Monti • San Martino ai Monti • San Pietro in Vincoli (Moisés de Miguel Ángel) • Parque Colle Oppio & Domus Aurea • Mercados y Foro de Trajano.',
    hidden_gems: 'Subterráneos de San Martino ai Monti (visitas guiadas) • Basílica Santa Práxedes (capilla de San Zenón) • Escalinata dei Borgia • Calles antiguas de la Suburra (Via Cavour/Leonina/Panisperna) • Casas romanas bajo Santa Pudenziana.',
    experiences: 'Aperitivo en Piazza Madonna dei Monti • Vintage en Mercato Monti (fines de semana) • Fotos al atardecer en rooftop/terraza • Paseo por Via Urbana & Via dei Serpenti • Tarde junto al Foro Romano y Piazza Venezia.',
    romantic_walk: 'Inicio: Via Leonina 71 → Coliseo → Arco de Constantino → Via dei Fori Imperiali → Piazza del Campidoglio → helado en Fatamorgana Monti → La Bottega del Caffè → regreso a Via Leonina 71.',
    checkin_access: 'Acceso: {front_door_access}. Edificio: código {building_code} (alternativa a la llave redonda).',
    checkout_note: 'Antes de salir: apaga luces/AC, cierra ventanas, deja las llaves en la mesa, cierra la puerta suavemente.'
  }
};

// ---------------- Template risposte per intent ----------------
const FAQ_TPL = {
  en: {
    wifi: `Wi-Fi: {wifi_note}\nNetwork: {wifi_ssid}. Password: {wifi_password}.`,
    checkin: `Check-in from ${base.checkin_time}.\n{checkin_access}\nNeed help? Call ${base.host_phone}.`,
    checkout: `{checkout_note}`,
    water: `{water_note}`,
    ac: `{ac_note}`,
    bathroom: `Bathroom: {bathroom_amenities}\nTowels: {towels_note}`,
    kitchen: `{kitchen_note}`,
    terrace: `Terrace: {terrace_note}\nPlants: {plants_note}\nLights: {lighting_note}`,
    services: `Supermarkets: {supermarkets}
Pharmacies: {pharmacies}
ATMs: {atms}
Laundry: {laundry}
Luggage: {luggage}
SIMs: {sims}`,
    transport: `{transport}
Airports: {airports}
Taxi: {taxi}`,
    eat: `{eat}`, drink:`{drink}`, shop:`{shop}`, visit:`{visit}`,
    hidden:`{hidden_gems}`,
    experience:`{experiences}\nRomantic route: {romantic_walk}`,
    daytrips:`Day trips: Ostia Antica (~40 min) • Tivoli (Villa d’Este & Hadrian’s Villa ~1h) • Castelli Romani.`,
    emergency:`{emergency}`
  },
  it: {
    wifi: `Wi-Fi: {wifi_note}\nRete: {wifi_ssid}. Password: {wifi_password}.`,
    checkin: `Check-in dalle ${base.checkin_time}.\n{checkin_access}\nServe aiuto? Chiama ${base.host_phone}.`,
    checkout: `{checkout_note}`,
    water: `{water_note}`,
    ac: `{ac_note}`,
    bathroom: `Bagno: {bathroom_amenities}\nAsciugamani: {towels_note}`,
    kitchen: `{kitchen_note}`,
    terrace: `Terrazzo: {terrace_note}\nPiante: {plants_note}\nLuci: {lighting_note}`,
    services: `Supermercati: {supermarkets}
Farmacie: {pharmacies}
Bancomat: {atms}
Lavanderia: {laundry}
Deposito bagagli: {luggage}
SIM: {sims}`,
    transport: `{transport}
Aeroporti: {airports}
Taxi: {taxi}`,
    eat:`{eat}`, drink:`{drink}`, shop:`{shop}`, visit:`{visit}`,
    hidden:`{hidden_gems}`,
    experience:`{experiences}\nPercorso romantico: {romantic_walk}`,
    daytrips:`Gite di un giorno: Ostia Antica (~40 min) • Tivoli (Villa d’Este & Villa Adriana ~1h) • Castelli Romani.`,
    emergency:`{emergency}`
  },
  fr: {
    wifi: `Wi-Fi : {wifi_note}\nRéseau : {wifi_ssid}. Mot de passe : {wifi_password}.`,
    checkin: `Arrivée à partir de ${base.checkin_time}.\n{checkin_access}\nBesoin d’aide ? ${base.host_phone}.`,
    checkout: `{checkout_note}`,
    water: `{water_note}`,
    ac: `{ac_note}`,
    bathroom: `Salle de bain : {bathroom_amenities}\nServiettes : {towels_note}`,
    kitchen: `{kitchen_note}`,
    terrace: `Terrasse : {terrace_note}\nPlantes : {plants_note}\nLumières : {lighting_note}`,
    services: `Supermarchés : {supermarkets}
Pharmacies : {pharmacies}
DAB : {atms}
Laverie : {laundry}
Consigne : {luggage}
Cartes SIM : {sims}`,
    transport: `{transport}
Aéroports : {airports}
Taxi : {taxi}`,
    eat:`{eat}`, drink:`{drink}`, shop:`{shop}`, visit:`{visit}`,
    hidden:`{hidden_gems}`,
    experience:`{experiences}\nParcours romantique : {romantic_walk}`,
    daytrips:`Excursions : Ostia Antica (~40 min) • Tivoli (Villa d’Este & Villa d’Hadrien ~1h) • Castelli Romani.`,
    emergency:`{emergency}`
  },
  de: {
    wifi: `WLAN: {wifi_note}\nNetz: {wifi_ssid}. Passwort: {wifi_password}.`,
    checkin: `Check-in ab ${base.checkin_time} Uhr.\n{checkin_access}\nHilfe? ${base.host_phone}.`,
    checkout: `{checkout_note}`,
    water: `{water_note}`,
    ac: `{ac_note}`,
    bathroom: `Bad: {bathroom_amenities}\nHandtücher: {towels_note}`,
    kitchen: `{kitchen_note}`,
    terrace: `Terrasse: {terrace_note}\nPflanzen: {plants_note}\nLicht: {lighting_note}`,
    services: `Supermärkte: {supermarkets}
Apotheken: {pharmacies}
Geldautomaten: {atms}
Waschsalon: {laundry}
Gepäck: {luggage}
SIM-Karten: {sims}`,
    transport: `{transport}
Flughäfen: {airports}
Taxi: {taxi}`,
    eat:`{eat}`, drink:`{drink}`, shop:`{shop}`, visit:`{visit}`,
    hidden:`{hidden_gems}`,
    experience:`{experiences}\nRomantische Route: {romantic_walk}`,
    daytrips:`Tagesausflüge: Ostia Antica (~40 Min) • Tivoli (Villa d’Este & Hadriansvilla ~1h) • Castelli Romani.`,
    emergency:`{emergency}`
  },
  es: {
    wifi: `Wi-Fi: {wifi_note}\nRed: {wifi_ssid}. Contraseña: {wifi_password}.`,
    checkin: `Check-in desde las ${base.checkin_time}.\n{checkin_access}\n¿Necesitas ayuda? ${base.host_phone}.`,
    checkout: `{checkout_note}`,
    water: `{water_note}`,
    ac: `{ac_note}`,
    bathroom: `Baño: {bathroom_amenities}\nToallas: {towels_note}`,
    kitchen: `{kitchen_note}`,
    terrace: `Terraza: {terrace_note}\nPlantas: {plants_note}\nLuces: {lighting_note}`,
    services: `Supermercados: {supermarkets}
Farmacias: {pharmacies}
Cajeros: {atms}
Lavandería: {laundry}
Consigna: {luggage}
SIM: {sims}`,
    transport: `{transport}
Aeropuertos: {airports}
Taxi: {taxi}`,
    eat:`{eat}`, drink:`{drink}`, shop:`{shop}`, visit:`{visit}`,
    hidden:`{hidden_gems}`,
    experience:`{experiences}\nRuta romántica: {romantic_walk}`,
    daytrips:`Excursiones: Ostia Antica (~40 min) • Tivoli (Villa d’Este & Villa Adriana ~1h) • Castelli Romani.`,
    emergency:`{emergency}`
  }
};

// ---------------- Intent matching (keyword EN) ----------------
const INTENTS = [
  { key:'wifi',      utter:['wifi','wi-fi','internet','password','router'] },
  { key:'checkin',   utter:['check in','arrival','access','entrance','door','front door','building','code','intercom'] },
  { key:'checkout',  utter:['check out','leave','departure'] },
  { key:'water',     utter:['water','hot water','drinkable','tap','mirror switch','boiler'] },
  { key:'ac',        utter:['ac','air conditioning','aircon','air conditioner'] },
  { key:'bathroom',  utter:['bathroom','hairdryer','soap','towels','amenities'] },
  { key:'kitchen',   utter:['kitchen','cook','cooking','stove','hot plate'] },
  { key:'terrace',   utter:['terrace','umbrella','plants','balcony','light','lights'] },
  { key:'services',  utter:['services','pharmacy','hospital','atm','sim','laundry','luggage','supermarket','groceries'] },
  { key:'transport', utter:['transport','tram','bus','taxi','airport','train','metro'] },
  { key:'eat',       utter:['eat','restaurant','dinner','lunch','food'] },
  { key:'drink',     utter:['drink','bar','wine','cocktail','aperitivo'] },
  { key:'shop',      utter:['shop','market','shopping','boutique','vintage'] },
  { key:'visit',     utter:['what to visit','see','sight','attraction','museum','moses','domus aurea'] },
  { key:'hidden',    utter:['hidden','secret','gem','less-known','underground','suburra','pudenziana'] },
  { key:'experience',utter:['experience','walk','tour','itinerary','sunset','romantic'] },
  { key:'daytrips',  utter:['day trips','day trip','tivoli','ostia','castelli','excursion','excursions'] },
  { key:'emergency', utter:['emergency','police','ambulance','fire','doctor','vet','help'] }
];

function norm(s){ return (s||'').toLowerCase().replace(/\s+/g,' ').trim(); }
function detectIntent(msg){
  const t = norm(msg); let best=null, scoreBest=0;
  for(const it of INTENTS){ let s=0; for(const u of it.utter){ if(t.includes(norm(u))) s++; } if(s>scoreBest){best=it; scoreBest=s;} }
  return best?.key || null;
}
function fill(tpl, dict){ return tpl.replace(/\{(\w+)\}/g,(_,k)=>dict[k] ?? `{${k}}`); }

// -------- OpenAI opzionale (non necessario per la localizzazione) --------
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const client = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;
async function polishOptional(text, lang){
  if (!client) return text;
  const sys = `You are a helpful assistant. Keep the language as: ${lang}. Do not change facts. Max ~120 words unless steps are needed.`;
  try{
    const r = await client.responses.create({
      model: OPENAI_MODEL,
      input: [{ role:'system', content: sys }, { role:'user', content: text }]
    });
    return r.output_text || text;
  }catch{ return text; }
}

// ---------------- API ----------------
app.post('/api/message', async (req,res)=>{
  const { message='', lang='en' } = req.body || {};
  const L = (APT_I18N[lang] ? lang : 'en');
  const intent = detectIntent(message);

  let out = '';
  if (intent) {
    const tpl = FAQ_TPL[L][intent];
    out = fill(tpl, APT_I18N[L]);
  } else {
    const fallback = {
      en:'I did not find a direct answer. Try a button or use keywords (wifi, check in, kitchen, terrace, transport…).',
      it:'Non ho trovato una risposta diretta. Prova un pulsante o usa parole chiave (wifi, check in, cucina, terrazzo, trasporti…).',
      fr:"Je n’ai pas trouvé de réponse directe. Essayez un bouton ou des mots-clés (wifi, check in, cuisine, terrasse, transports…).",
      de:'Keine direkte Antwort gefunden. Nutze einen Button oder Stichwörter (WLAN, Check-in, Küche, Terrasse, Verkehr…).',
      es:'No encontré una respuesta directa. Prueba un botón o usa palabras clave (wifi, check in, cocina, terraza, transporte…).'
    }[L];
    out = fallback;
  }
  const text = await polishOptional(out, L);
  res.json({ text, intent });
});

// ---------------- UI (single file) ----------------
app.get('/', (_req,res)=>{
  const BUTTON_KEYS = [
    'wifi','check in','check out','water','AC','bathroom','kitchen','terrace',
    'eat','drink','shop','visit','hidden gems','experience','day trips',
    'transport','services','emergency'
  ];

  const UI_I18N = {
    en:{ welcome:'Hi, I am Samantha, your virtual guide. Tap a button to get a quick answer.',
         placeholder:'Hi, I am Samantha, your virtual guide. Tap a button for a quick answer — or type here…',
         buttons:{ wifi:'wifi','check in':'check in','check out':'check out','water':'water','AC':'AC','bathroom':'bathroom','kitchen':'kitchen','terrace':'terrace',
           eat:'eat', drink:'drink', shop:'shop', visit:'visit', 'hidden gems':'hidden gems', experience:'experience', 'day trips':'day trips',
           transport:'transport', services:'services', emergency:'emergency' },
         voice_on:'🔊 Voice: On', voice_off:'🔇 Voice: Off', apt_label: base.apt_label.en },
    it:{ welcome:'Ciao, sono Samantha, la tua guida virtuale. Tocca un pulsante per una risposta rapida.',
         placeholder:'Ciao, sono Samantha, la tua guida virtuale. Tocca un pulsante — oppure scrivi qui…',
         buttons:{ wifi:'wifi','check in':'check in','check out':'check out','water':'acqua','AC':'aria condizionata','bathroom':'bagno','kitchen':'cucina','terrace':'terrazzo',
           eat:'mangiare', drink:'bere', shop:'shopping', visit:'visitare', 'hidden gems':'gemme nascoste', experience:'esperienze', 'day trips':'gite di un giorno',
           transport:'trasporti', services:'servizi', emergency:'emergenza' },
         voice_on:'🔊 Voce: On', voice_off:'🔇 Voce: Off', apt_label: base.apt_label.it },
    fr:{ welcome:'Bonjour, je suis Samantha, votre guide virtuel. Touchez un bouton pour une réponse rapide.',
         placeholder:'Bonjour, je suis Samantha, votre guide virtuel. Touchez un bouton — ou écrivez ici…',
         buttons:{ wifi:'wifi','check in':'check in','check out':'check out','water':'eau','AC':'climatisation','bathroom':'salle de bain','kitchen':'cuisine','terrace':'terrasse',
           eat:'manger', drink:'boire', shop:'shopping', visit:'visiter', 'hidden gems':'trésors cachés', experience:'expériences', 'day trips':'excursions',
           transport:'transports', services:'services', emergency:'urgence' },
         voice_on:'🔊 Voix : Activée', voice_off:'🔇 Voix : Désactivée', apt_label: base.apt_label.fr },
    de:{ welcome:'Hallo, ich bin Samantha, dein virtueller Guide. Tippe auf einen Button für eine schnelle Antwort.',
         placeholder:'Hallo, ich bin Samantha, dein virtueller Guide. Tippe auf einen Button — oder schreibe hier…',
         buttons:{ wifi:'WLAN','check in':'check in','check out':'check out','water':'Wasser','AC':'Klimaanlage','bathroom':'Bad','kitchen':'Küche','terrace':'Terrasse',
           eat:'Essen', drink:'Trinken', shop:'Shopping', visit:'Sehenswürdigkeiten', 'hidden gems':'versteckte Juwelen', experience:'Erlebnisse', 'day trips':'Tagesausflüge',
           transport:'Verkehr', services:'Services', emergency:'Notfall' },
         voice_on:'🔊 Stimme: An', voice_off:'🔇 Stimme: Aus', apt_label: base.apt_label.de },
    es:{ welcome:'Hola, soy Samantha, tu guía virtual. Toca un botón para una respuesta rápida.',
         placeholder:'Hola, soy Samantha, tu guía virtual. Toca un botón — o escribe aquí…',
         buttons:{ wifi:'wifi','check in':'check in','check out':'check out','water':'agua','AC':'aire acondicionado','bathroom':'baño','kitchen':'cocina','terrace':'terraza',
           eat:'comer', drink:'beber', shop:'compras', visit:'visitar', 'hidden gems':'joyas ocultas', experience:'experiencias', 'day trips':'excursiones',
           transport:'transporte', services:'servicios', emergency:'emergencia' },
         voice_on:'🔊 Voz: Activada', voice_off:'🔇 Voz: Desactivada', apt_label: base.apt_label.es }
  };

  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Guest Help — Via Leonina 71</title>
<link rel="icon" type="image/png" href="logo-niceflatinrome.jpg">
<style>
*{box-sizing:border-box} body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f6f6f6}
.wrap{max-width:760px;margin:0 auto;min-height:100vh;display:flex;flex-direction:column}
header{position:sticky;top:0;background:#fff;border-bottom:1px solid #e0e0e0;padding:10px 14px}
.h-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.h-left{display:flex;align-items:center;gap:10px}
.brand{font-weight:700;color:#a33}
.apt{margin-left:auto;opacity:.75}
img.logo{height:36px;width:auto;display:block}
.controls{display:flex;gap:8px;margin-top:8px;align-items:center;flex-wrap:wrap}
.lang{display:flex;gap:6px;margin-left:auto}
.lang button{border:1px solid #ddd;background:#fff;padding:6px 8px;border-radius:10px;cursor:pointer;font-size:13px}
.lang button[aria-current="true"]{background:#2b2118;color:#fff;border-color:#2b2118}
#voiceBtn{padding:8px 10px;border:1px solid #ddd;background:#fff;border-radius:10px;cursor:pointer;font-size:14px}
#voiceBtn[aria-pressed="true"]{background:#2b2118;color:#fff;border-color:#2b2118}
main{flex:1;padding:12px}
.msg{max-width:85%;line-height:1.35;border-radius:12px;padding:10px 12px;margin:8px 0;white-space:pre-wrap}
.msg.wd{background:#fff;border:1px solid #e0e0e0}
.msg.me{background:#e8f0fe;border:1px solid #c5d5ff;margin-left:auto}
.quick{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}
.quick button{border:1px solid #d6c5b8;background:#fff;color:#333;padding:6px 10px;border-radius:12px;cursor:pointer}
.quick button:active{transform:translateY(1px)}
footer{position:sticky;bottom:0;background:#fff;display:flex;gap:8px;padding:10px;border-top:1px solid #e0e0e0}
input{flex:1;padding:12px;border:1px solid #cbd5e1;border-radius:10px;outline:none}
#sendBtn{padding:12px 14px;border:1px solid #2b2118;background:#2b2118;color:#fff;border-radius:10px;cursor:pointer}
</style></head>
<body>
<div class="wrap">
  <header>
    <div class="h-row">
      <div class="h-left">
        <img class="logo" src="logo-niceflatinrome.jpg" alt="NiceFlatInRome">
        <div class="brand">niceflatinrome.com</div>
      </div>
      <div class="apt"><span id="aptLabel">${base.apt_label.en}</span>: ${base.apartment_id}</div>
    </div>
    <div class="controls">
      <button id="voiceBtn" aria-pressed="false" title="Toggle voice">🔇 Voice: Off</button>
      <nav class="lang" aria-label="Language">
        <button data-lang="en" aria-current="true">EN</button>
        <button data-lang="it">IT</button>
        <button data-lang="fr">FR</button>
        <button data-lang="de">DE</button>
        <button data-lang="es">ES</button>
      </nav>
    </div>
  </header>

  <main id="chat" aria-live="polite"></main>

  <footer>
    <input id="input" placeholder="Hi, I am Samantha, your virtual guide. Tap a button for a quick answer — or type here…" autocomplete="off">
    <button id="sendBtn">Send</button>
  </footer>
</div>
<script>
const UI_I18N = ${JSON.stringify(UI_I18N)};
const BUTTON_KEYS = ${JSON.stringify(BUTTON_KEYS)};

const chatEl = document.getElementById('chat');
const input = document.getElementById('input');
const sendBtn = document.getElementById('sendBtn');

// Lang init (?lang -> localStorage -> navigator)
const url = new URL(location);
let lang = (url.searchParams.get('lang') || localStorage.getItem('lang') || (navigator.language||'en').slice(0,2)).toLowerCase();
if(!UI_I18N[lang]) lang='en';
url.searchParams.set('lang', lang); history.replaceState(null,'',url);
localStorage.setItem('lang', lang);

// ---------- TTS con voce madrelingua ----------
let voiceOn = false, pick = null;
const VOICE_PREFS = {
  en: ['Samantha','Google US English'],
  it: ['Alice','Eloisa','Google italiano'],
  fr: ['Amelie','Thomas','Google français'],
  de: ['Anna','Markus','Google Deutsch'],
  es: ['Monica','Jorge','Paulina','Google español']
};
function selectVoice(){
  if(!('speechSynthesis' in window)) return null;
  const all = speechSynthesis.getVoices()||[];
  const prefs = VOICE_PREFS[lang]||[];
  for(const name of prefs){
    const v = all.find(v => (v.name||'').toLowerCase()===name.toLowerCase());
    if(v) return v;
  }
  const byLang = all.find(v => (v.lang||'').toLowerCase().startsWith(lang));
  return byLang || all[0] || null;
}
function refreshVoice(){ pick = selectVoice(); }
if('speechSynthesis' in window){
  refreshVoice(); speechSynthesis.onvoiceschanged = refreshVoice;
}
function warm(){
  if(!('speechSynthesis' in window)) return;
  try{
    speechSynthesis.cancel();
    const dot = new SpeechSynthesisUtterance('.');
    dot.rate=1; dot.pitch=1; dot.volume=0.01;
    if(pick) dot.voice=pick;
    dot.lang = pick?.lang || lang;
    speechSynthesis.speak(dot);
  }catch{}
}
function speak(t){
  if(!voiceOn || !('speechSynthesis' in window)) return;
  try{
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(t);
    if(pick) u.voice=pick;
    u.lang = pick?.lang || lang;
    speechSynthesis.speak(u);
  }catch{}
}

document.getElementById('voiceBtn').addEventListener('click',e=>{
  voiceOn = !voiceOn;
  e.currentTarget.setAttribute('aria-pressed', String(voiceOn));
  applyUI();
  if(voiceOn) warm();
});
document.querySelector('.lang').addEventListener('click',e=>{
  const btn = e.target.closest('[data-lang]'); if(!btn) return;
  lang = btn.getAttribute('data-lang');
  localStorage.setItem('lang', lang);
  const u = new URL(location); u.searchParams.set('lang', lang); history.replaceState(null,'',u);
  refreshVoice(); applyUI(); chatEl.innerHTML=''; welcome();
  if(voiceOn) warm();
});

function applyUI(){
  const t = UI_I18N[lang] || UI_I18N.en;
  document.getElementById('aptLabel').textContent = t.apt_label;
  document.getElementById('voiceBtn').textContent = voiceOn ? t.voice_on : t.voice_off;
  input.placeholder = t.placeholder;
  document.querySelectorAll('.lang [data-lang]').forEach(b=>{
    b.setAttribute('aria-current', b.getAttribute('data-lang')===lang ? 'true':'false');
  });
}

function add(type, txt){
  const d=document.createElement('div');
  d.className='msg '+(type==='me'?'me':'wd');
  d.textContent=txt;
  chatEl.appendChild(d);
  chatEl.scrollTop=chatEl.scrollHeight;
}
function welcome(){
  const t = UI_I18N[lang] || UI_I18N.en;
  add('wd', t.welcome);
  const q=document.createElement('div'); q.className='quick';
  for(const key of BUTTON_KEYS){
    const label = t.buttons[key] || key;
    const b=document.createElement('button'); b.textContent=label;
    b.onclick=()=>{ input.value=key; send(); }; // invia keyword EN
    q.appendChild(b);
  }
  chatEl.appendChild(q);
}

async function send(){
  const text=(input.value||'').trim(); if(!text) return;
  add('me', text); input.value='';
  try{
    const r=await fetch('/api/message',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({message:text, lang})
    });
    const data=await r.json();
    const bot=data.text||'Sorry, something went wrong.';
    add('wd',bot); speak(bot);
  }catch{
    add('wd','Network error. Please try again.');
  }
}
sendBtn.addEventListener('click',send);
input.addEventListener('keydown',e=>{ if(e.key==='Enter') send(); });

applyUI();
welcome();
</script>
</body></html>`;
  res.setHeader('content-type','text/html; charset=utf-8');
  res.end(html);
});

// ---------------- Start ----------------
const port = process.env.PORT || 8787;
app.listen(port, ()=>console.log('Guest assistant up on http://localhost:'+port));
