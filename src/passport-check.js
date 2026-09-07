// ════════════════════════════════════════════════════════════════════════════
// CONTROLLO PASSAPORTI T-1
// Il giorno prima di ogni check-in verifica che sull'arrival form di Hostaway
// ci sia un documento per OGNI ospite, minori compresi. Se ne mancano, parte
// un avviso.
//
// Il blocco non e' una minaccia a vuoto: la Fase 2 (link della guida) e la
// Fase 3 (chiavi digitali) partono dal webhook di check-in online in
// /hostaway-incoming, cioe' solo quando l'ospite ha completato il form. Chi
// non carica i documenti non riceve il link e il giorno dell'arrivo non entra:
// l'avviso serve a dirglielo mentre c'e' ancora tempo per rimediare.
//
// Da dove arriva il dato: l'API pubblica v1 NON espone i documenti caricati
// (/v1/arrivalForms restituisce solo reservationId + isSubmitted). I documenti
// stanno sull'endpoint del guest portal, che si legge con il guestAuthHash
// della prenotazione:
//   GET https://platform.hostaway.com/guestPortal/arrivalForm/:rid?auth=:hash
// Ogni ospite e' un blocco con due campi foto, idPhoto (bottone "Upload") e
// selfie (bottone "Selfie"): il blocco conta come coperto se almeno uno dei
// due e' pieno. Se il form non e' mai stato aperto l'endpoint risponde 200 con
// result null (o 404 con {"status":"fail"}): nessun documento caricato.
// ════════════════════════════════════════════════════════════════════════════

import axios from "axios";

const HOSTAWAY_API = "https://api.hostaway.com/v1";
const GUEST_PORTAL_API = "https://platform.hostaway.com/guestPortal";

const CANCELLED = new Set([
  "cancelled", "canceled", "declined", "expired",
  "inquiry", "inquirynotpossible", "inquiry_timedout", "inquirytimedout"
]);

// ── Testo dell'avviso, nella lingua dell'ospite ─────────────────────────────
// Coperte le 12 lingue che compaiono davvero nelle prenotazioni (~95%); per
// tutte le altre si usa l'inglese. Ogni lingua porta un `marker`, una frase
// contenuta nel suo testo: serve a riconoscere un avviso gia' inviato e a non
// mandarlo due volte se il servizio riparte (lo stato in memoria si azzera, la
// conversazione Hostaway no). Il conteggio e' sempre "ricevuti X su Y", cosi'
// nessuna lingua deve accordare singolare e plurale.
const TEXTS = {
  en: {
    marker: "we must register an identity document for every guest",
    lines: (v) => [
      `Hello ${v.name},`, ``,
      `You are checking in tomorrow (${v.date}) and your online check-in is not complete yet.`, ``,
      `As required by Italian law, we must register an identity document for every guest staying in the apartment, children of any age included: ${v.expected} in total. So far we have received ${v.docs} of ${v.expected}.`, ``,
      `Please upload the missing documents here:`, v.portal, ``,
      `For each guest use the "Upload" button or the "Selfie" button and send a clear photo of the front page of the passport or ID card.`, ``,
      `Please note: the link to your digital guide — the one that carries the electronic keys to open the building door and the apartment — is sent automatically only once the online check-in is complete, with the document of every guest. Until then the keys cannot be issued and you will not be able to get into the apartment on the day of your arrival.`, ``,
      `It only takes a minute. Thank you!`
    ]
  },
  it: {
    marker: "dobbiamo registrare un documento di identità per ogni ospite",
    lines: (v) => [
      `Ciao ${v.name},`, ``,
      `Domani (${v.date}) è il giorno del tuo arrivo e il check-in online non è ancora completo.`, ``,
      `Come richiede la legge italiana, dobbiamo registrare un documento di identità per ogni ospite che soggiorna nell'appartamento, minori di qualunque età compresi: ${v.expected} in totale. Finora ne abbiamo ricevuti ${v.docs} su ${v.expected}.`, ``,
      `Carica qui i documenti mancanti:`, v.portal, ``,
      `Per ogni ospite usa il pulsante "Upload" oppure il pulsante "Selfie" e invia una foto nitida della prima pagina del passaporto o della carta d'identità.`, ``,
      `Attenzione: il link alla guida digitale — quello che contiene le chiavi elettroniche per aprire il portone e l'appartamento — viene inviato in automatico solo quando il check-in online è completo, con il documento di ogni ospite. Fino ad allora le chiavi non possono essere emesse e il giorno dell'arrivo non potrai entrare nell'appartamento.`, ``,
      `Basta un minuto. Grazie!`
    ]
  },
  es: {
    marker: "debemos registrar un documento de identidad de cada huésped",
    lines: (v) => [
      `Hola ${v.name},`, ``,
      `Mañana (${v.date}) es el día de tu llegada y tu check-in online todavía no está completo.`, ``,
      `Como exige la ley italiana, debemos registrar un documento de identidad de cada huésped que se aloja en el apartamento, incluidos los menores de cualquier edad: ${v.expected} en total. Hasta ahora hemos recibido ${v.docs} de ${v.expected}.`, ``,
      `Sube aquí los documentos que faltan:`, v.portal, ``,
      `Para cada huésped usa el botón "Upload" o el botón "Selfie" y envía una foto nítida de la primera página del pasaporte o del documento de identidad.`, ``,
      `Importante: el enlace a tu guía digital — el que contiene las llaves electrónicas para abrir el portal y el apartamento — se envía automáticamente solo cuando el check-in online está completo, con el documento de cada huésped. Hasta entonces las llaves no se pueden emitir y el día de tu llegada no podrás entrar en el apartamento.`, ``,
      `Solo lleva un minuto. ¡Gracias!`
    ]
  },
  fr: {
    marker: "nous devons enregistrer une pièce d'identité pour chaque voyageur",
    lines: (v) => [
      `Bonjour ${v.name},`, ``,
      `Vous arrivez demain (${v.date}) et votre check-in en ligne n'est pas encore complet.`, ``,
      `Comme l'exige la loi italienne, nous devons enregistrer une pièce d'identité pour chaque voyageur séjournant dans l'appartement, enfants de tout âge compris : ${v.expected} au total. Nous en avons reçu ${v.docs} sur ${v.expected}.`, ``,
      `Merci de téléverser ici les documents manquants :`, v.portal, ``,
      `Pour chaque voyageur, utilisez le bouton "Upload" ou le bouton "Selfie" et envoyez une photo nette de la première page du passeport ou de la carte d'identité.`, ``,
      `Important : le lien vers votre guide numérique — celui qui contient les clés électroniques pour ouvrir la porte de l'immeuble et l'appartement — est envoyé automatiquement uniquement lorsque le check-in en ligne est complet, avec le document de chaque voyageur. Jusque-là, les clés ne peuvent pas être délivrées et le jour de votre arrivée vous ne pourrez pas entrer dans l'appartement.`, ``,
      `Cela ne prend qu'une minute. Merci !`
    ]
  },
  de: {
    marker: "müssen wir von jedem Gast ein Ausweisdokument erfassen",
    lines: (v) => [
      `Hallo ${v.name},`, ``,
      `Sie reisen morgen an (${v.date}) und Ihr Online-Check-in ist noch nicht vollständig.`, ``,
      `Wie es das italienische Gesetz verlangt, müssen wir von jedem Gast ein Ausweisdokument erfassen, der in der Wohnung übernachtet, Kinder jeden Alters eingeschlossen: insgesamt ${v.expected}. Bisher haben wir ${v.docs} von ${v.expected} erhalten.`, ``,
      `Bitte laden Sie die fehlenden Dokumente hier hoch:`, v.portal, ``,
      `Verwenden Sie für jeden Gast die Schaltfläche "Upload" oder "Selfie" und senden Sie ein scharfes Foto der ersten Seite des Reisepasses oder Personalausweises.`, ``,
      `Wichtig: Der Link zu Ihrem digitalen Guide – der die elektronischen Schlüssel für die Haustür und die Wohnung enthält – wird automatisch erst dann verschickt, wenn der Online-Check-in mit dem Dokument jedes Gastes vollständig ist. Bis dahin können die Schlüssel nicht ausgestellt werden und Sie kommen am Anreisetag nicht in die Wohnung.`, ``,
      `Es dauert nur eine Minute. Vielen Dank!`
    ]
  },
  nl: {
    marker: "moeten wij van elke gast een identiteitsbewijs registreren",
    lines: (v) => [
      `Hallo ${v.name},`, ``,
      `U komt morgen aan (${v.date}) en uw online check-in is nog niet compleet.`, ``,
      `Zoals de Italiaanse wet vereist, moeten wij van elke gast een identiteitsbewijs registreren die in het appartement verblijft, kinderen van elke leeftijd inbegrepen: ${v.expected} in totaal. Tot nu toe hebben wij er ${v.docs} van ${v.expected} ontvangen.`, ``,
      `Upload de ontbrekende documenten hier:`, v.portal, ``,
      `Gebruik voor elke gast de knop "Upload" of de knop "Selfie" en stuur een scherpe foto van de eerste pagina van het paspoort of de identiteitskaart.`, ``,
      `Let op: de link naar uw digitale gids — die de elektronische sleutels bevat om de deur van het gebouw en het appartement te openen — wordt automatisch pas verstuurd wanneer de online check-in compleet is, met het document van elke gast. Tot dan kunnen de sleutels niet worden afgegeven en kunt u op de dag van aankomst het appartement niet in.`, ``,
      `Het kost maar een minuut. Bedankt!`
    ]
  },
  pl: {
    marker: "musimy zarejestrować dokument tożsamości każdego gościa",
    lines: (v) => [
      `Dzień dobry, ${v.name},`, ``,
      `Jutro (${v.date}) zaczyna się Państwa pobyt, a odprawa online nie została jeszcze ukończona.`, ``,
      `Zgodnie z włoskim prawem musimy zarejestrować dokument tożsamości każdego gościa nocującego w apartamencie, w tym dzieci w każdym wieku: łącznie ${v.expected}. Do tej pory otrzymaliśmy ${v.docs} z ${v.expected}.`, ``,
      `Prosimy o przesłanie brakujących dokumentów tutaj:`, v.portal, ``,
      `Dla każdego gościa proszę użyć przycisku "Upload" lub przycisku "Selfie" i wysłać wyraźne zdjęcie pierwszej strony paszportu lub dowodu osobistego.`, ``,
      `Uwaga: link do przewodnika cyfrowego — tego, który zawiera elektroniczne klucze do drzwi budynku i apartamentu — jest wysyłany automatycznie dopiero wtedy, gdy odprawa online jest kompletna, z dokumentem każdego gościa. Do tego czasu klucze nie mogą zostać wydane i w dniu przyjazdu nie będzie można wejść do apartamentu.`, ``,
      `To zajmuje tylko chwilę. Dziękujemy!`
    ]
  },
  ru: {
    marker: "мы обязаны зарегистрировать документ, удостоверяющий личность каждого гостя",
    lines: (v) => [
      `Здравствуйте, ${v.name}!`, ``,
      `Завтра (${v.date}) день вашего заезда, а онлайн-регистрация ещё не завершена.`, ``,
      `По требованию итальянского законодательства мы обязаны зарегистрировать документ, удостоверяющий личность каждого гостя, проживающего в квартире, включая детей любого возраста: всего ${v.expected}. На данный момент получено ${v.docs} из ${v.expected}.`, ``,
      `Загрузите недостающие документы здесь:`, v.portal, ``,
      `Для каждого гостя используйте кнопку "Upload" или кнопку "Selfie" и отправьте чёткое фото первой страницы паспорта или удостоверения личности.`, ``,
      `Обратите внимание: ссылка на цифровой гид — та, в которой находятся электронные ключи от подъезда и квартиры — отправляется автоматически только после завершения онлайн-регистрации с документом каждого гостя. До этого ключи не выдаются, и в день приезда вы не сможете попасть в квартиру.`, ``,
      `Это займёт одну минуту. Спасибо!`
    ]
  },
  he: {
    marker: "עלינו לרשום מסמך זיהוי עבור כל אורח",
    lines: (v) => [
      `שלום ${v.name},`, ``,
      `מחר (${v.date}) יום ההגעה שלך, והצ'ק-אין המקוון עדיין לא הושלם.`, ``,
      `על פי החוק האיטלקי, עלינו לרשום מסמך זיהוי עבור כל אורח השוהה בדירה, כולל ילדים בכל גיל: ${v.expected} בסך הכול. עד כה קיבלנו ${v.docs} מתוך ${v.expected}.`, ``,
      `נא להעלות כאן את המסמכים החסרים:`, v.portal, ``,
      `עבור כל אורח יש להשתמש בכפתור "Upload" או בכפתור "Selfie" ולשלוח תמונה ברורה של העמוד הראשון בדרכון או בתעודת הזהות.`, ``,
      `שימו לב: הקישור למדריך הדיגיטלי — זה שמכיל את המפתחות האלקטרוניים לפתיחת דלת הבניין והדירה — נשלח אוטומטית רק לאחר שהצ'ק-אין המקוון הושלם, עם מסמך של כל אורח. עד אז לא ניתן להנפיק את המפתחות ולא תוכלו להיכנס לדירה ביום ההגעה.`, ``,
      `זה לוקח רק דקה. תודה!`
    ]
  },
  el: {
    marker: "πρέπει να καταχωρίσουμε ταυτότητα ή διαβατήριο για κάθε επισκέπτη",
    lines: (v) => [
      `Γεια σας ${v.name},`, ``,
      `Αύριο (${v.date}) είναι η ημέρα άφιξής σας και το online check-in δεν έχει ολοκληρωθεί ακόμη.`, ``,
      `Όπως απαιτεί η ιταλική νομοθεσία, πρέπει να καταχωρίσουμε ταυτότητα ή διαβατήριο για κάθε επισκέπτη που διαμένει στο διαμέρισμα, συμπεριλαμβανομένων των παιδιών κάθε ηλικίας: ${v.expected} συνολικά. Μέχρι τώρα έχουμε λάβει ${v.docs} από ${v.expected}.`, ``,
      `Ανεβάστε εδώ τα έγγραφα που λείπουν:`, v.portal, ``,
      `Για κάθε επισκέπτη χρησιμοποιήστε το κουμπί "Upload" ή το κουμπί "Selfie" και στείλτε μια καθαρή φωτογραφία της πρώτης σελίδας του διαβατηρίου ή της ταυτότητας.`, ``,
      `Προσοχή: ο σύνδεσμος για τον ψηφιακό οδηγό — αυτός που περιέχει τα ηλεκτρονικά κλειδιά για την είσοδο της πολυκατοικίας και του διαμερίσματος — αποστέλλεται αυτόματα μόνο όταν ολοκληρωθεί το online check-in, με το έγγραφο κάθε επισκέπτη. Μέχρι τότε τα κλειδιά δεν μπορούν να εκδοθούν και την ημέρα της άφιξης δεν θα μπορέσετε να μπείτε στο διαμέρισμα.`, ``,
      `Χρειάζεται μόνο ένα λεπτό. Ευχαριστούμε!`
    ]
  },
  sv: {
    marker: "måste vi registrera en identitetshandling för varje gäst",
    lines: (v) => [
      `Hej ${v.name},`, ``,
      `I morgon (${v.date}) är din ankomstdag och din incheckning online är inte klar än.`, ``,
      `Enligt italiensk lag måste vi registrera en identitetshandling för varje gäst som bor i lägenheten, barn i alla åldrar inkluderade: ${v.expected} totalt. Hittills har vi fått ${v.docs} av ${v.expected}.`, ``,
      `Ladda upp de handlingar som saknas här:`, v.portal, ``,
      `Använd knappen "Upload" eller knappen "Selfie" för varje gäst och skicka ett tydligt foto av passets eller ID-kortets första sida.`, ``,
      `Observera: länken till din digitala guide — den som innehåller de elektroniska nycklarna till porten och lägenheten — skickas automatiskt först när incheckningen online är komplett, med handling för varje gäst. Fram till dess kan nycklarna inte utfärdas och du kommer inte in i lägenheten på ankomstdagen.`, ``,
      `Det tar bara en minut. Tack!`
    ]
  },
  pt: {
    marker: "temos de registar um documento de identificação de cada hóspede",
    lines: (v) => [
      `Olá ${v.name},`, ``,
      `Amanhã (${v.date}) é o dia da sua chegada e o check-in online ainda não está completo.`, ``,
      `Como exige a lei italiana, temos de registar um documento de identificação de cada hóspede que fica no apartamento, incluindo crianças de qualquer idade: ${v.expected} no total. Até agora recebemos ${v.docs} de ${v.expected}.`, ``,
      `Carregue aqui os documentos em falta:`, v.portal, ``,
      `Para cada hóspede utilize o botão "Upload" ou o botão "Selfie" e envie uma foto nítida da primeira página do passaporte ou do cartão de identidade.`, ``,
      `Atenção: o link para o seu guia digital — o que contém as chaves eletrónicas para abrir a porta do prédio e o apartamento — é enviado automaticamente apenas quando o check-in online estiver completo, com o documento de cada hóspede. Até lá as chaves não podem ser emitidas e no dia da chegada não conseguirá entrar no apartamento.`, ``,
      `Demora apenas um minuto. Obrigado!`
    ]
  }
};

// Tutte le frasi-firma, in ogni lingua: un avviso gia' inviato va riconosciuto
// anche se era partito in un'altra lingua.
export const PASSPORT_MARKERS = Object.values(TEXTS).map(t => t.marker);

// Stessa risoluzione della lingua usata dalle guide (Fase 2 e 3) in server.js.
export function guestLang(r) {
  const raw = String(r.guestLanguage || r.guestLocale || "en").toLowerCase();
  const named = {
    english: "en", italian: "it", italiano: "it", spanish: "es", espanol: "es",
    french: "fr", francais: "fr", german: "de", deutsch: "de", dutch: "nl",
    polish: "pl", russian: "ru", hebrew: "he", greek: "el", swedish: "sv",
    portuguese: "pt"
  };
  const first = raw.split(",")[0].trim();
  const code = named[first] || first.split(/[-_]/)[0];
  return TEXTS[code] ? code : "en";
}

function authHeaders() {
  return {
    Authorization: `Bearer ${process.env.HOSTAWAY_TOKEN}`,
    "Cache-control": "no-cache"
  };
}

// Serve un documento per ogni persona che dorme in casa, minori di qualunque
// eta' compresi. numberOfGuests di solito li contiene gia', ma i neonati su
// Hostaway stanno in un campo a parte: si prende il totale piu' alto.
export function expectedDocuments(r) {
  const adults = Number(r.adults) || 0;
  const children = Number(r.children) || 0;
  const infants = Number(r.infants) || 0;
  return Math.max(Number(r.numberOfGuests) || 0, adults + children + infants, 1);
}

// Arrivi di una data precisa, cancellazioni escluse.
export async function fetchArrivals(day) {
  const params = new URLSearchParams({
    arrivalStartDate: day, arrivalEndDate: day, limit: "100"
  });
  const resp = await axios.get(`${HOSTAWAY_API}/reservations?${params}`, {
    headers: authHeaders(), timeout: 15000
  });
  const all = resp.data?.result || [];
  // Hostaway a volte ignora i filtri di data → si rifiltra qui.
  return all.filter(r =>
    (r.arrivalDate || r.checkInDate) === day &&
    !CANCELLED.has(String(r.status || "").toLowerCase())
  );
}

// Quanti documenti sono stati caricati.
// Ritorna { status: "read" | "no_form" | "unknown", docs, photos, slots }
export async function fetchUploadedDocuments(r) {
  if (!r.guestAuthHash) return { status: "unknown", reason: "guestAuthHash mancante", docs: 0 };
  const url = `${GUEST_PORTAL_API}/arrivalForm/${r.id}?auth=${encodeURIComponent(r.guestAuthHash)}`;
  let resp;
  try {
    resp = await axios.get(url, { timeout: 15000 });
  } catch (e) {
    const code = e.response?.status;
    const body = e.response?.data;
    // 404 + {"status":"fail"} = form mai aperto, quindi zero documenti.
    if (code === 404 && body && typeof body === "object" && body.status === "fail") {
      return { status: "no_form", docs: 0, photos: 0, slots: 0 };
    }
    // Qualsiasi altra risposta: non si sa. Meglio non accusare nessuno.
    return { status: "unknown", reason: `HTTP ${code || e.code || e.message}`, docs: 0 };
  }
  // Form mai aperto: l'endpoint risponde 200 con result null (oppure 404, sopra).
  const form = resp.data?.result;
  if (resp.data?.status === "success" && (form === null || form === undefined)) {
    return { status: "no_form", docs: 0, photos: 0, slots: 0 };
  }
  if (!form || !Array.isArray(form.guests)) {
    return { status: "unknown", reason: "risposta senza guests", docs: 0 };
  }
  let docs = 0, photos = 0;
  for (const g of form.guests) {
    const n = (g.idPhoto ? 1 : 0) + (g.selfie ? 1 : 0);
    photos += n;
    if (n > 0) docs++;
  }
  return {
    status: "read", docs, photos, slots: form.guests.length,
    isSubmitted: !!form.isSubmitted, updatedOn: form.updatedOn
  };
}

// L'arrival form deve essere attivo per quell'appartamento e quel canale:
// se Hostaway non lo propone all'ospite, non gli si puo' chiedere niente.
export async function isArrivalFormActive(r) {
  if (!r.guestAuthHash) return { active: false, reason: "guestAuthHash mancante" };
  try {
    const resp = await axios.get(
      `${GUEST_PORTAL_API}/arrivalFormSetting/${r.id}?auth=${encodeURIComponent(r.guestAuthHash)}`,
      { timeout: 15000 }
    );
    const s = resp.data?.result;
    if (!s) return { active: false, reason: "nessuna impostazione" };
    if (!s.isActive) return { active: false, reason: "form non attivo sull'appartamento" };
    const channels = Array.isArray(s.channelIds) ? s.channelIds.map(Number) : null;
    if (channels && r.channelId && !channels.includes(Number(r.channelId))) {
      return { active: false, reason: `canale ${r.channelName || r.channelId} escluso dal form` };
    }
    return { active: true };
  } catch (e) {
    // Impostazione illeggibile: si prosegue, il controllo sui documenti resta valido.
    return { active: true, reason: `impostazione non letta (${e.response?.status || e.message})` };
  }
}

// L'avviso e' gia' partito nelle ultime ore su questa conversazione?
export async function warningAlreadySent(conversationId, hours = 20) {
  if (!conversationId) return false;
  try {
    const resp = await axios.get(
      `${HOSTAWAY_API}/conversations/${conversationId}/messages?limit=20`,
      { headers: authHeaders(), timeout: 10000 }
    );
    const cutoff = Date.now() - hours * 3600 * 1000;
    return (resp.data?.result || []).some(m => {
      const body = String(m.body || "");
      if (!PASSPORT_MARKERS.some(mk => body.includes(mk))) return false;
      const ts = new Date(m.date || m.insertedOn || m.insertedAt || 0).getTime();
      return !ts || ts >= cutoff;
    });
  } catch {
    return false; // in caso di errore non si blocca l'invio
  }
}

export function buildGuestWarning(r, { docs, expected, lang }) {
  const code = lang || guestLang(r);
  const t = TEXTS[code] || TEXTS.en;
  const name = r.guestFirstName || (r.guestName || "").split(" ")[0] || "";
  const portal = r.guestPortalUrl ||
    (r.guestAuthHash ? `https://guest-portal.hostaway.com/${r.id}/${r.guestAuthHash}` : "");
  const body = t.lines({ name: name.trim(), date: r.arrivalDate, expected, docs, portal });
  return [...body, ``, `Michele`, `NiceFlat Rome`].join("\n");
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

export function buildHostReport(day, rows) {
  const missing = rows.filter(x => x.outcome === "warned" || x.outcome === "would_warn" || x.outcome === "already_warned");
  const unknown = rows.filter(x => x.outcome === "unknown");
  const lines = [];
  lines.push(`Controllo passaporti — arrivi del ${day}`);
  lines.push(`Prenotazioni controllate: ${rows.length}`);
  lines.push("");
  if (missing.length) {
    lines.push("DOCUMENTI MANCANTI:");
    for (const x of missing) {
      lines.push(`- ${x.guestName} (${x.reservationId}, apt ${x.listingMapId}, ${x.channelName}): ${x.docs}/${x.expected} — ${x.outcome === "already_warned" ? "avviso gia' inviato" : x.outcome === "would_warn" ? "avviso NON inviato (prova a secco)" : `avviso inviato in ${x.lang}`}`);
    }
    lines.push("");
  }
  if (unknown.length) {
    lines.push("DA VERIFICARE A MANO (dato non letto, nessun avviso inviato):");
    for (const x of unknown) lines.push(`- ${x.guestName} (${x.reservationId}): ${x.reason}`);
    lines.push("");
  }
  const ok = rows.filter(x => x.outcome === "ok");
  if (ok.length) {
    lines.push("COMPLETE:");
    for (const x of ok) lines.push(`- ${x.guestName} (${x.reservationId}): ${x.docs}/${x.expected}`);
  }

  const html = `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:620px;margin:0 auto">
    <h2 style="font-size:17px;color:#1d1812;margin:0 0 4px">🛂 Controllo passaporti — arrivi del ${esc(day)}</h2>
    <p style="color:#7a6f5c;font-size:13px;margin:0 0 16px">${rows.length} prenotazione/i controllate · ${missing.length} incomplete · ${unknown.length} da verificare</p>
    ${rows.map(x => {
      const bad = x.outcome !== "ok";
      return `<table role="presentation" width="100%" style="border-collapse:collapse;margin:0 0 10px;background:#fff;border:1px solid ${bad ? "#e0b4b4" : "#e6e0d5"};border-radius:10px;overflow:hidden">
        <tr><td style="background:${bad ? "#7d2a2a" : "#1d1812"};color:#f2d58a;padding:9px 13px;font-weight:700;font-size:14px">${bad ? "⚠️" : "✅"} ${esc(x.guestName)}</td></tr>
        <tr><td style="padding:10px 13px;font-size:13px;color:#222;line-height:1.6">
          <b>Documenti:</b> ${esc(x.docs)}/${esc(x.expected)}${x.photos != null ? ` (foto totali: ${esc(x.photos)})` : ""} · <b>lingua:</b> ${esc(x.lang || "—")}<br>
          <b>Prenotazione:</b> ${esc(x.reservationId)} · apt ${esc(x.listingMapId)} · ${esc(x.channelName)}<br>
          <b>Esito:</b> ${esc(x.outcome)}${x.reason ? ` — ${esc(x.reason)}` : ""}
        </td></tr></table>`;
    }).join("")}
    <p style="color:#9a8f7c;font-size:12px;margin-top:16px">Controllo automatico NiceFlat · un giorno prima di ogni check-in</p>
  </div>`;

  const subject = `🛂 Passaporti arrivi ${day} — ${missing.length} incomplete su ${rows.length}`;
  return { subject, text: lines.join("\n"), html };
}

// ── Il controllo ────────────────────────────────────────────────────────────
// deps: { getConversationId, sendGuestMessage, sendHostEmail, log }
// opts: { day, dryRun }
export async function runPassportCheck(deps, opts = {}) {
  const log = deps.log || console.log;
  const dryRun = !!opts.dryRun;
  const day = opts.day;
  if (!process.env.HOSTAWAY_TOKEN) {
    log("❌ Controllo passaporti: HOSTAWAY_TOKEN mancante");
    return { day, rows: [], skipped: "no_token" };
  }

  const arrivals = await fetchArrivals(day);
  log(`🛂 Controllo passaporti ${day}: ${arrivals.length} arrivo/i da controllare${dryRun ? " (prova a secco)" : ""}`);
  const rows = [];

  for (const r of arrivals) {
    const base = {
      reservationId: r.id, guestName: r.guestName || "Ospite",
      listingMapId: r.listingMapId, channelName: r.channelName || "—",
      expected: expectedDocuments(r), lang: guestLang(r)
    };

    const active = await isArrivalFormActive(r);
    if (!active.active) {
      rows.push({ ...base, docs: 0, outcome: "skipped", reason: active.reason });
      log(`   ↷ ${r.id} ${base.guestName}: saltata (${active.reason})`);
      continue;
    }

    const found = await fetchUploadedDocuments(r);
    if (found.status === "unknown") {
      rows.push({ ...base, docs: 0, outcome: "unknown", reason: found.reason });
      log(`   ? ${r.id} ${base.guestName}: dato non letto (${found.reason}) → nessun avviso`);
      continue;
    }

    const row = { ...base, docs: found.docs, photos: found.photos, slots: found.slots };

    if (found.docs >= base.expected) {
      rows.push({ ...row, outcome: "ok" });
      log(`   ✅ ${r.id} ${base.guestName}: ${found.docs}/${base.expected}`);
      continue;
    }

    const conversationId = await deps.getConversationId(r.id);
    if (!conversationId) {
      rows.push({ ...row, outcome: "unknown", reason: "conversazione Hostaway non trovata" });
      log(`   ? ${r.id} ${base.guestName}: nessuna conversazione → avviso non inviabile`);
      continue;
    }
    if (await warningAlreadySent(conversationId)) {
      rows.push({ ...row, outcome: "already_warned" });
      log(`   ⏭ ${r.id} ${base.guestName}: ${found.docs}/${base.expected}, avviso gia' inviato`);
      continue;
    }
    if (dryRun) {
      rows.push({ ...row, outcome: "would_warn" });
      log(`   ⚠️ ${r.id} ${base.guestName}: ${found.docs}/${base.expected} → avviso DA INVIARE in ${base.lang} (prova a secco)`);
      continue;
    }

    const message = buildGuestWarning(r, { docs: found.docs, expected: base.expected, lang: base.lang });
    await deps.sendGuestMessage({ conversationId, message });
    rows.push({ ...row, outcome: "warned" });
    log(`   📨 ${r.id} ${base.guestName}: ${found.docs}/${base.expected} → avviso inviato in ${base.lang}`);
  }

  // Riepilogo all'host solo se c'e' qualcosa da dire.
  const worth = rows.some(x => x.outcome !== "ok" && x.outcome !== "skipped");
  if (worth && deps.sendHostEmail && !dryRun) {
    try {
      await deps.sendHostEmail(buildHostReport(day, rows));
      log("📧 Controllo passaporti: riepilogo inviato all'host");
    } catch (e) {
      log(`❌ Controllo passaporti: riepilogo non inviato (${e.message})`);
    }
  }

  return { day, dryRun, rows };
}
