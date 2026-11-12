import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://kgyihqyuuhoxiegbwwiy.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_KZb5HjTdjUYyrOmJjUPgsw_CTPwuhQ5";
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { db: { schema: "raft" } });

const ROLE_NAMES = { raft_admin: "Admin", raft_scheduler: "Scheduler", raft_counselor: "Counselor" };
const CONTACT_COLUMNS = "personid,firstname,lastname,address,city,state,zip,phone,email";
const CLIENT_COLUMNS = "clientid,foundout,remindermethod,referredby";
const BASE_APPOINTMENT_COLUMNS = "appointmentid,appointmenttime,duration,counselorid,employeeid,roomnumber";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const signInScreen = $("#sign-in-screen");
const staffApp = $("#staff-app");
const signInForm = $("#sign-in-form");
const signInButton = $("#sign-in-button");
const signInError = $("#sign-in-error");
const globalNotice = $("#global-notice");
const recordAction = $("#record-action");
const recordFormArea = $("#record-form-area");
const recordFormHeading = $("#record-form-heading");

let currentSession = null;
let currentRole = null;
let currentSessionKey = null;
let loadedSessionKey = null;
let activeScreen = "home";
let selectedClientID = null;
let clientDetailToken = 0;
let searchRows = [];
let homeLoadToken = 0;
let dashboardLoadToken = 0;
let clientSearchToken = 0;
let recordLoadToken = 0;

function decodeRole(session) {
  const token = session?.access_token;
  if (!token) return null;
  try {
    const payloadPart = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payloadPart.padEnd(Math.ceil(payloadPart.length / 4) * 4, "=");
    const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))));
    return ROLE_NAMES[payload.role] ? payload.role : null;
  } catch {
    return null;
  }
}

function roleLabel(role = currentRole) { return ROLE_NAMES[role] ?? "Staff"; }
function isAdmin() { return currentRole === "raft_admin"; }
function isCounselor() { return currentRole === "raft_counselor"; }
function canSeeNotes() { return isAdmin() || isCounselor(); }
function canSeeAssignment() { return isAdmin() || isCounselor(); }

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
function display(value) { return value === null || value === undefined || value === "" ? "—" : String(value); }
function fullName(person) { return [person?.firstname, person?.lastname].filter(Boolean).join(" ") || `Person #${person?.personid ?? ""}`; }
function initials(person) { return `${person?.firstname?.[0] ?? ""}${person?.lastname?.[0] ?? ""}`.toUpperCase() || "R"; }
function blankNull(value) { const clean = String(value ?? "").trim(); return clean === "" ? null : clean; }
function numericOrNull(value) { const clean = String(value ?? "").trim(); return clean === "" ? null : Number(clean); }
function sayError(error) {
  if (!error) return "Something went wrong. Please try again.";
  const text = error.message || error.details || String(error);
  if (/permission denied for table/i.test(text)) return `The database denied access for your ${roleLabel()} role. Ask your RAFT administrator to review the role policies.`;
  return text;
}
function showGlobalNotice(message, type = "error") {
  globalNotice.textContent = message;
  globalNotice.className = `global-notice ${type}`;
  globalNotice.hidden = false;
}
function clearGlobalNotice() { globalNotice.hidden = true; globalNotice.textContent = ""; }
function setFormStatus(form, message, type = "") {
  const status = $(".form-status", form);
  if (!status) return;
  status.textContent = message;
  status.className = `form-status${type ? ` ${type}` : ""}`;
}
function setButtonBusy(button, busy, busyText = "Working…") {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.innerHTML;
    button.innerHTML = `<span class="spinner"></span> ${escapeHtml(busyText)}`;
    button.disabled = true;
  } else {
    button.innerHTML = button.dataset.originalText || "Save changes";
    button.disabled = false;
  }
}
async function result(promise) {
  const { data, error } = await promise;
  if (error) throw error;
  return data;
}
async function countResult(promise) {
  const { count, error } = await promise;
  if (error) throw error;
  return count ?? 0;
}
function formValue(form, name) { return new FormData(form).get(name); }
function optionsHtml(options, selected = "", placeholder = "Choose…") {
  const optionRows = options.map((item) => `<option value="${escapeHtml(item.value)}"${String(item.value) === String(selected) ? " selected" : ""}>${escapeHtml(item.label)}</option>`).join("");
  return `<option value="">${escapeHtml(placeholder)}</option>${optionRows}`;
}
function field(label, name, opts = {}) {
  const { type = "text", value = "", required = false, full = false, placeholder = "", options = [], rows = 3, help = "", min = "", max = "", step = "", maxLength = "", multiple = false, autocomplete = "off" } = opts;
  const classes = `form-field${full ? " full" : ""}`;
  const req = required ? " required" : "";
  let control;
  if (type === "select") {
    const selectOptions = multiple ? options.map((item) => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`).join("") : optionsHtml(options, value, placeholder || "Choose…");
    control = `<select name="${escapeHtml(name)}"${req}${multiple ? " multiple size=5" : ""}>${selectOptions}</select>`;
  } else if (type === "textarea") {
    control = `<textarea name="${escapeHtml(name)}" placeholder="${escapeHtml(placeholder)}"${req}${maxLength ? ` maxlength="${escapeHtml(maxLength)}"` : ""} rows="${rows}">${escapeHtml(value)}</textarea>`;
  } else {
    const constraints = `${min ? ` min="${escapeHtml(min)}"` : ""}${max ? ` max="${escapeHtml(max)}"` : ""}${step ? ` step="${escapeHtml(step)}"` : ""}${maxLength ? ` maxlength="${escapeHtml(maxLength)}"` : ""}`;
    control = `<input name="${escapeHtml(name)}" type="${escapeHtml(type)}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" autocomplete="${escapeHtml(autocomplete)}"${constraints}${req} />`;
  }
  return `<div class="${classes}"><label>${escapeHtml(label)}${required ? " *" : ""}</label>${control}${help ? `<span class="field-help">${escapeHtml(help)}</span>` : ""}</div>`;
}
function saveFooter(buttonText = "Save record") {
  return `<div class="form-actions"><span class="form-status" aria-live="polite"></span><button class="button button-primary" type="submit">${escapeHtml(buttonText)} <span aria-hidden="true">↗</span></button></div>`;
}
function setRecordHeading(eyebrow, title) {
  recordFormHeading.innerHTML = `<p class="eyebrow">${escapeHtml(eyebrow)}</p><h2>${escapeHtml(title)}</h2>`;
}

function showSignIn(message = "") {
  currentSession = null;
  currentRole = null;
  currentSessionKey = null;
  loadedSessionKey = null;
  selectedClientID = null;
  clientDetailToken++;
  homeLoadToken++;
  dashboardLoadToken++;
  clientSearchToken++;
  recordLoadToken++;
  signInScreen.hidden = false;
  staffApp.hidden = true;
  signInForm.reset();
  signInError.textContent = message;
  signInError.hidden = !message;
  clearGlobalNotice();
  recordAction.replaceChildren(new Option("Choose an action…", ""));
  recordFormArea.innerHTML = `<div class="record-empty"><div class="empty-detail-icon">＋</div><strong>Ready when you are</strong><span>Pick an action from the left to load the form.</span></div>`;
  $("#client-results").replaceChildren();
  $("#client-detail").innerHTML = `<div class="empty-detail"><div class="empty-detail-icon">⌕</div><strong>Client details will appear here</strong><span>Choose a person from your search results.</span></div>`;
  $("#upcoming-list").replaceChildren();
  $("#dashboard-stats").replaceChildren();
  $("#month-activity").replaceChildren();
  searchRows = [];
}

async function applySession(session) {
  if (!session) { showSignIn(); return; }
  const role = decodeRole(session);
  if (!role) {
    currentSession = session;
    currentRole = null;
    loadedSessionKey = null;
    currentSessionKey = `${session.user?.id ?? "unknown"}:invalid`;
    clientDetailToken++;
    homeLoadToken++;
    dashboardLoadToken++;
    clientSearchToken++;
    recordLoadToken++;
    signInScreen.hidden = false;
    staffApp.hidden = true;
    signInError.textContent = "Your password was accepted, but the access token is missing a supported RAFT role. Check the staff_role metadata and Access Token Hook in Supabase, then sign in again. No RAFT data was loaded.";
    signInError.hidden = false;
    recordAction.replaceChildren(new Option("Choose an action…", ""));
    recordFormArea.replaceChildren();
    $("#client-results").replaceChildren();
    $("#client-detail").replaceChildren();
    $("#upcoming-list").replaceChildren();
    $("#dashboard-stats").replaceChildren();
    $("#month-activity").replaceChildren();
    $$(".screen").forEach((screen) => { screen.hidden = true; screen.classList.remove("active"); });
    return;
  }
  const key = `${session.user?.id ?? "unknown"}:${role}`;
  currentSession = session;
  currentRole = role;
  currentSessionKey = key;
  signInScreen.hidden = true;
  staffApp.hidden = false;
  $("#staff-email").textContent = session.user?.email ?? "Signed in";
  $("#staff-role").textContent = roleLabel(role);
  $("#role-chip").textContent = roleLabel(role);
  $("#staff-avatar").textContent = (session.user?.email?.[0] ?? "R").toUpperCase();
  $("#home-schedule-button").hidden = isCounselor();
  $("#home-add-appointment-link").hidden = isCounselor();
  $("#access-title").textContent = `${roleLabel(role)} access`;
  $("#access-description").textContent = role === "raft_admin"
    ? "Full access to RAFT records, including employee wages."
    : role === "raft_scheduler"
      ? "Manage people, clients, rooms, and appointments. Employee wages, private notes, and assignment details stay hidden."
      : "View RAFT records and update appointment notes, assignments, and kept status.";
  if (loadedSessionKey !== key) {
    loadedSessionKey = key;
    setRecordActions();
    activeScreen = "home";
    setScreen("home");
  } else {
    updateScreenVisibility();
  }
}

function setRecordActions() {
  let actions;
  if (isCounselor()) {
    actions = [["", "Choose an action…"], ["edit_appointment_notes", "Update appointment notes"], ["edit_scheduledfor", "Update client appointment details"]];
  } else {
    actions = [["", "Choose an action…"], ["new_client", "Add a client"], ["edit_client", "Edit a client"], ["new_appointment", "Add an appointment"], ["edit_appointment", "Edit an appointment"], ["edit_scheduledfor", "Update client appointment details"], ["edit_person", "Edit contact details"], ["new_room", "Add a room"], ["edit_room", "Edit a room"], ["edit_employee", isAdmin() ? "Edit employee (including wage)" : "Edit employee details"]];
  }
  recordAction.innerHTML = actions.map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join("");
}

function updateScreenVisibility() {
  $$(".screen").forEach((screen) => {
    const active = screen.id === `screen-${activeScreen}`;
    screen.hidden = !active;
    screen.classList.toggle("active", active);
  });
  $$(".nav-link").forEach((link) => link.classList.toggle("active", link.dataset.screen === activeScreen));
  const labels = { home: "Home", lookup: "Client lookup", dashboard: "Dashboard", records: "Add or edit" };
  $("#current-section-label").textContent = labels[activeScreen] ?? "Home";
}
function setScreen(screen) {
  if (!currentSession || !currentRole) return;
  activeScreen = screen;
  updateScreenVisibility();
  clearGlobalNotice();
  if (screen === "home") loadHome();
  if (screen === "dashboard") loadDashboard();
  if (screen === "records" && recordAction.value) renderRecordForm(recordAction.value);
}

function appointmentDateLabel(value, options = {}) {
  if (!value) return "Time not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(undefined, { weekday: options.weekday ? "short" : undefined, month: "short", day: "numeric", hour: options.timeOnly ? undefined : "numeric", minute: options.timeOnly ? undefined : "2-digit" }).format(date);
}
function appointmentTimeOnly(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
}
function appointmentDateOnly(value) {
  if (!value) return "Date not set";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}
function dateTimeLocalValue(value) {
  if (!value) return "";
  const raw = String(value);
  if (/^\d{4}-\d\d-\d\d[T ]\d\d:\d\d/.test(raw) && !/[zZ]|[+-]\d\d:?\d\d$/.test(raw)) return raw.replace(" ", "T").slice(0, 16);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).replace(" ", "T").slice(0, 16);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}
function databaseLocalTimestamp(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
function dateValue(value) { return value ? String(value).slice(0, 10) : ""; }

async function loadHome() {
  if (!currentSession || !currentRole) return;
  const token = ++homeLoadToken;
  const list = $("#upcoming-list");
  list.innerHTML = `<div class="loading-row"><span class="spinner"></span> Loading today’s schedule…</div>`;
  try {
    const now = databaseLocalTimestamp(new Date());
    let appts = await result(supabase.from("appointment").select(BASE_APPOINTMENT_COLUMNS).gte("appointmenttime", now).order("appointmenttime", { ascending: true }).limit(7));
    let activityMode = "upcoming";
    if (!appts?.length) {
      appts = await result(supabase.from("appointment").select(BASE_APPOINTMENT_COLUMNS).not("appointmenttime", "is", null).order("appointmenttime", { ascending: false }).limit(7));
      activityMode = "recent";
    }
    if (token !== homeLoadToken || currentSessionKey === null) return;
    $("#appointments-kicker").textContent = activityMode === "upcoming" ? "COMING UP" : "LATEST IN RAFT";
    $("#appointments-heading").textContent = activityMode === "upcoming" ? "Upcoming appointments" : "Most recent appointments";
    const appointments = await enrichAppointments(appts ?? []);
    if (token !== homeLoadToken) return;
    if (!appointments.length) {
      list.innerHTML = `<div class="empty-row">No appointments with dates are recorded in the database.</div>`;
      return;
    }
    list.innerHTML = appointments.map((item) => {
      const clientNames = item.clients.length ? item.clients.map((person) => escapeHtml(fullName(person))).join(", ") : "No client linked";
      return `<div class="appointment-row"><span class="appointment-time"><strong>${escapeHtml(appointmentTimeOnly(item.appointment.appointmenttime))}</strong><small>${escapeHtml(appointmentDateOnly(item.appointment.appointmenttime))}</small></span><span class="appointment-person">${clientNames}</span><span class="appointment-meta">${escapeHtml(item.counselor ? `With ${fullName(item.counselor)}` : `Appointment #${item.appointment.appointmentid}`)}${item.appointment.duration ? ` · ${escapeHtml(item.appointment.duration)} min` : ""}${item.employee ? ` · ${escapeHtml(fullName(item.employee))}` : ""}</span><span class="appointment-room">${escapeHtml(item.room ? item.room.roomname || `Room ${item.room.roomnumber}` : item.appointment.roomnumber ? `Room ${item.appointment.roomnumber}` : "Room —")}</span><span class="appointment-tag">${activityMode === "upcoming" ? "Scheduled" : "Recent"}</span></div>`;
    }).join("");
  } catch (error) {
    if (token !== homeLoadToken) return;
    list.innerHTML = `<div class="empty-row">${escapeHtml(sayError(error))}</div>`;
  }
}

async function enrichAppointments(appts) {
  if (!appts.length) return [];
  const appointmentIDs = appts.map((row) => row.appointmentid);
  const [links, counselors, employees, rooms] = await Promise.all([
    result(supabase.from("scheduledfor").select("appointmentid,clientid").in("appointmentid", appointmentIDs)),
    result(supabase.from("counselor").select("counselorid").in("counselorid", [...new Set(appts.map((row) => row.counselorid).filter(Boolean))])),
    result(supabase.from("employee").select("employeeid").in("employeeid", [...new Set(appts.map((row) => row.employeeid).filter(Boolean))])),
    result(supabase.from("room").select("roomnumber,roomname").in("roomnumber", [...new Set(appts.map((row) => row.roomnumber).filter((value) => value !== null))]))
  ]);
  const personIDs = [...new Set([...(links ?? []).map((row) => row.clientid), ...(counselors ?? []).map((row) => row.counselorid), ...(employees ?? []).map((row) => row.employeeid)].filter(Boolean))];
  const people = personIDs.length ? await result(supabase.from("person").select(CONTACT_COLUMNS).in("personid", personIDs)) : [];
  const peopleMap = new Map((people ?? []).map((person) => [person.personid, person]));
  const roomMap = new Map((rooms ?? []).map((room) => [room.roomnumber, room]));
  const linksByAppointment = new Map();
  for (const link of links ?? []) {
    const current = linksByAppointment.get(link.appointmentid) ?? [];
    current.push(peopleMap.get(link.clientid) ?? { personid: link.clientid });
    linksByAppointment.set(link.appointmentid, current);
  }
  return appts.map((appointment) => ({
    appointment,
    clients: linksByAppointment.get(appointment.appointmentid) ?? [],
    counselor: peopleMap.get(appointment.counselorid) ?? null,
    employee: peopleMap.get(appointment.employeeid) ?? null,
    room: roomMap.get(appointment.roomnumber) ?? null
  }));
}

function sanitizeSearch(value) { return value.replace(/[\\%_]/g, (match) => `\\${match}`); }
async function searchClients(term) {
  const clean = sanitizeSearch(term.trim());
  const tokens = term.trim().split(/\s+/).filter(Boolean);
  const personQuery = (column, value) => result(supabase.from("person").select(CONTACT_COLUMNS).ilike(column, `%${sanitizeSearch(value)}%`).limit(40));
  const peopleResults = await Promise.all([
    personQuery("firstname", tokens[0] || clean),
    personQuery("lastname", tokens.length > 1 ? tokens.slice(1).join(" ") : clean),
    personQuery("email", clean),
    personQuery("phone", clean),
    /^\d+$/.test(term.trim()) ? result(supabase.from("person").select(CONTACT_COLUMNS).eq("personid", Number(term.trim())).limit(1)) : Promise.resolve([])
  ]);
  const personMap = new Map();
  for (const row of peopleResults.flat()) personMap.set(row.personid, row);
  const people = [...personMap.values()];
  if (!people.length) return [];
  const clients = await result(supabase.from("client").select(CLIENT_COLUMNS).in("clientid", people.map((person) => person.personid)));
  const clientIDs = new Set((clients ?? []).map((client) => client.clientid));
  const clientMap = new Map((clients ?? []).map((client) => [client.clientid, client]));
  return people.filter((person) => clientIDs.has(person.personid)).map((person) => ({ person, client: clientMap.get(person.personid) })).sort((a, b) => fullName(a.person).localeCompare(fullName(b.person)));
}

function renderClientResults(rows) {
  const container = $("#client-results");
  if (!rows.length) {
    container.innerHTML = `<div class="result-empty">No matching client records. Try a shorter name or a different detail.</div>`;
    return;
  }
  container.innerHTML = rows.map(({ person, client }) => `<button class="client-result${person.personid === selectedClientID ? " selected" : ""}" type="button" data-client-id="${escapeHtml(person.personid)}"><span class="client-result-avatar">${escapeHtml(initials(person))}</span><span class="client-result-copy"><strong>${escapeHtml(fullName(person))}</strong><span>${escapeHtml(person.phone || person.email || "Contact details not listed")}</span></span><span class="client-result-id">#${escapeHtml(client.clientid)}</span></button>`).join("");
}

async function loadFamilyInfo(memberID) {
  const memberRows = await result(supabase.from("family_member").select("memberid").eq("memberid", memberID));
  if (!memberRows?.length) return [];
  const memberships = await result(supabase.from("member_in_family").select("familyid,memberid,datejoined").eq("memberid", memberID));
  if (!memberships?.length) return [];
  const familyIDs = memberships.map((membership) => membership.familyid);
  const [families, memberRoles] = await Promise.all([
    result(supabase.from("family").select("familyid,familyname,datefounded").in("familyid", familyIDs)),
    result(supabase.from("member_role").select("familyid,memberid,roleid").eq("memberid", memberID))
  ]);
  const roleIDs = [...new Set((memberRoles ?? []).map((row) => row.roleid))];
  const roles = roleIDs.length ? await result(supabase.from("role").select("roleid,rolename").in("roleid", roleIDs)) : [];
  const familyMap = new Map((families ?? []).map((family) => [family.familyid, family]));
  const roleMap = new Map((roles ?? []).map((role) => [role.roleid, role.rolename]));
  return memberships.map((membership) => ({
    ...membership,
    family: familyMap.get(membership.familyid),
    roles: (memberRoles ?? []).filter((role) => role.familyid === membership.familyid).map((role) => roleMap.get(role.roleid)).filter(Boolean)
  }));
}

async function loadClientDetail(clientID) {
  const token = ++clientDetailToken;
  selectedClientID = Number(clientID);
  renderClientResults(searchRows);
  const detail = $("#client-detail");
  detail.innerHTML = `<div class="empty-detail"><span class="spinner"></span><strong>Loading client record…</strong></div>`;
  try {
    const [clientRows, personRows] = await Promise.all([
      result(supabase.from("client").select(CLIENT_COLUMNS).eq("clientid", selectedClientID).limit(1)),
      result(supabase.from("person").select(CONTACT_COLUMNS).eq("personid", selectedClientID).limit(1))
    ]);
    const client = clientRows?.[0];
    const person = personRows?.[0];
    if (!client || !person) throw new Error("Client record is no longer available.");
    const scheduledColumns = canSeeAssignment() ? "appointmentid,clientid,assignment,kept" : "appointmentid,clientid,kept";
    const scheduled = await result(supabase.from("scheduledfor").select(scheduledColumns).eq("clientid", selectedClientID).order("appointmentid", { ascending: false }).limit(100));
    const appointmentIDs = [...new Set((scheduled ?? []).map((row) => row.appointmentid))];
    const appointmentColumns = canSeeNotes() ? `${BASE_APPOINTMENT_COLUMNS},notes` : BASE_APPOINTMENT_COLUMNS;
    const appointments = appointmentIDs.length ? await result(supabase.from("appointment").select(appointmentColumns).in("appointmentid", appointmentIDs).order("appointmenttime", { ascending: false })) : [];
    if (token !== clientDetailToken) return;
    let families = [];
    let familyError = "";
    try { families = await loadFamilyInfo(selectedClientID); } catch (error) { familyError = sayError(error); }
    const enriched = await enrichAppointments(appointments ?? []);
    if (token !== clientDetailToken) return;
    const appointmentByID = new Map(enriched.map((row) => [row.appointment.appointmentid, row]));
    renderClientDetail(person, client, scheduled ?? [], appointmentByID, families, familyError);
  } catch (error) {
    if (token !== clientDetailToken) return;
    detail.innerHTML = `<div class="result-empty">${escapeHtml(sayError(error))}</div>`;
  }
}

function renderClientDetail(person, client, scheduled, appointmentByID, families, familyError = "") {
  const address = [person.address, person.city, person.state, person.zip].filter(Boolean).join(", ");
  const referral = client.referredby ? `Client #${client.referredby}` : "Not recorded";
  const appointmentRows = scheduled.map((link) => appointmentByID.get(link.appointmentid)).filter(Boolean).map((row) => {
    const appt = row.appointment;
    const link = scheduled.find((item) => item.appointmentid === appt.appointmentid);
    const status = link.kept === true ? "Kept" : link.kept === false ? "Not kept" : "Not marked";
    const staffAndRoom = [row.counselor ? `Counselor: ${fullName(row.counselor)}` : "", row.employee ? `Employee: ${fullName(row.employee)}` : "", row.room ? `Room: ${row.room.roomname || row.room.roomnumber}` : ""].filter(Boolean).join(" · ");
    const privateDetails = [canSeeAssignment() ? link.assignment : "", canSeeNotes() ? appt.notes : ""].filter(Boolean).join(" · ");
    return `<div class="mini-appointment"><strong>${escapeHtml(appointmentDateLabel(appt.appointmenttime))}</strong><span>${escapeHtml(`${staffAndRoom || `Appointment #${appt.appointmentid}`}${appt.duration ? ` · ${appt.duration} min` : ""}`)}${privateDetails ? `<small class="appointment-private-detail">${escapeHtml(privateDetails)}</small>` : ""}</span><span>${escapeHtml(status)}</span></div>`;
  }).join("");
  const familyMarkup = families.length ? families.map((item) => `<span class="family-chip"><strong>${escapeHtml(item.family?.familyname || `Family #${item.familyid}`)}</strong><span>${escapeHtml(item.roles.length ? item.roles.join(", ") : "Role not recorded")}</span></span>`).join("") : `<div class="detail-empty-text">${familyError ? escapeHtml(familyError) : "No family memberships are recorded."}</div>`;
  const safeContact = (icon, value) => value ? `<div class="contact-item"><span class="contact-icon">${icon}</span><span>${escapeHtml(value)}</span></div>` : "";
  $("#client-detail").innerHTML = `<div class="detail-header"><span class="detail-avatar">${escapeHtml(initials(person))}</span><div><h2>${escapeHtml(fullName(person))}</h2><p>Client record · Richmond Area Family Therapy</p></div><span class="detail-id">#${escapeHtml(client.clientid)}</span></div><div class="detail-columns"><div class="detail-block"><h3>Contact information</h3>${safeContact("✉", person.email)}${safeContact("⌕", person.phone)}${safeContact("⌂", address)}${!person.email && !person.phone && !address ? `<div class="detail-empty-text">No contact details recorded.</div>` : ""}</div><div class="detail-block"><h3>Client details</h3><div class="data-pair"><span>Reminder method</span><strong>${escapeHtml(display(client.remindermethod))}</strong></div><div class="data-pair"><span>Found out about RAFT</span><strong>${escapeHtml(display(client.foundout))}</strong></div><div class="data-pair"><span>Referred by</span><strong>${escapeHtml(referral)}</strong></div></div></div><div class="detail-section"><div class="detail-section-title"><h3>Appointments</h3><span class="count-pill">${scheduled.length} linked</span></div>${appointmentRows || `<div class="detail-empty-text">${scheduled.length ? "Appointment details could not be loaded." : "No appointments are linked to this client."}</div>`}</div><div class="detail-section"><div class="detail-section-title"><h3>Family connections</h3><span class="count-pill">${families.length} families</span></div>${familyMarkup}</div>`;
}

async function loadDashboard() {
  if (!currentRole || !currentSession) return;
  const token = ++dashboardLoadToken;
  const stats = $("#dashboard-stats");
  const activity = $("#month-activity");
  stats.innerHTML = `<div class="stat-loading"><span class="spinner"></span> Loading statistics…</div>`;
  activity.innerHTML = `<span class="spinner"></span>`;
  try {
    const [clientCount, appointmentCount, counselorCount, roomCount, latestAppointments, keptCount] = await Promise.all([
      countResult(supabase.from("client").select("clientid", { count: "exact", head: true })),
      countResult(supabase.from("appointment").select("appointmentid", { count: "exact", head: true })),
      countResult(supabase.from("counselor").select("counselorid", { count: "exact", head: true })),
      countResult(supabase.from("room").select("roomnumber", { count: "exact", head: true })),
      result(supabase.from("appointment").select("appointmentid,appointmenttime").not("appointmenttime", "is", null).order("appointmenttime", { ascending: false }).limit(1)),
      countResult(supabase.from("scheduledfor").select("appointmentid", { count: "exact", head: true }).eq("kept", true))
    ]);
    if (token !== dashboardLoadToken || !currentSession) return;
    let monthCount = 0;
    let monthLabel = "No dated appointments";
    if (latestAppointments?.[0]?.appointmenttime) {
      const latestDate = new Date(latestAppointments[0].appointmenttime);
      if (!Number.isNaN(latestDate.getTime())) {
        const firstOfMonth = new Date(latestDate.getFullYear(), latestDate.getMonth(), 1, 0, 0, 0, 0);
        const nextMonth = new Date(latestDate.getFullYear(), latestDate.getMonth() + 1, 1, 0, 0, 0, 0);
        monthCount = await countResult(supabase.from("appointment").select("appointmentid", { count: "exact", head: true }).gte("appointmenttime", databaseLocalTimestamp(firstOfMonth)).lt("appointmenttime", databaseLocalTimestamp(nextMonth)));
        monthLabel = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(latestDate);
      }
    }
    if (token !== dashboardLoadToken || !currentSession) return;
    $("#activity-period-label").textContent = monthLabel;
    stats.innerHTML = [
      ["♙", "Clients", clientCount], ["◷", "Appointments", appointmentCount], ["✳", "Counselors", counselorCount], ["▦", "Rooms", roomCount]
    ].map(([icon, label, value]) => `<div class="stat-card"><span class="stat-icon">${icon}</span><span class="stat-label">${escapeHtml(label)}</span><strong class="stat-value">${escapeHtml(value)}</strong></div>`).join("");
    activity.innerHTML = `<strong>${escapeHtml(monthCount)}</strong><small>appointments in ${escapeHtml(monthLabel)} · ${escapeHtml(keptCount)} client visits marked kept overall</small>`;
  } catch (error) {
    if (token !== dashboardLoadToken) return;
    stats.innerHTML = `<div class="stat-loading">${escapeHtml(sayError(error))}</div>`;
    activity.textContent = "Statistics unavailable.";
  }
}

async function loadClientOptions() {
  const clients = await result(supabase.from("client").select(CLIENT_COLUMNS).order("clientid", { ascending: true }).limit(1000));
  const ids = (clients ?? []).map((row) => row.clientid);
  const people = ids.length ? await result(supabase.from("person").select(CONTACT_COLUMNS).in("personid", ids)) : [];
  const peopleById = new Map((people ?? []).map((person) => [person.personid, person]));
  return (clients ?? []).map((client) => ({ client, person: peopleById.get(client.clientid) ?? { personid: client.clientid } }));
}
async function loadPersonOptions() {
  return await result(supabase.from("person").select(CONTACT_COLUMNS).order("lastname", { ascending: true }).order("firstname", { ascending: true }).limit(1000)) ?? [];
}
async function loadRoomOptions() {
  return await result(supabase.from("room").select("roomnumber,roomname").order("roomnumber", { ascending: true })) ?? [];
}
async function loadStaffOptions() {
  const [counselors, employees] = await Promise.all([
    result(supabase.from("counselor").select("counselorid").order("counselorid", { ascending: true })),
    result(supabase.from("employee").select("employeeid").order("employeeid", { ascending: true }))
  ]);
  const ids = [...new Set([...(counselors ?? []).map((row) => row.counselorid), ...(employees ?? []).map((row) => row.employeeid)])];
  const people = ids.length ? await result(supabase.from("person").select(CONTACT_COLUMNS).in("personid", ids)) : [];
  const peopleById = new Map((people ?? []).map((person) => [person.personid, person]));
  return {
    counselors: (counselors ?? []).map((row) => ({ value: row.counselorid, label: fullName(peopleById.get(row.counselorid) ?? { personid: row.counselorid }) })),
    employees: (employees ?? []).map((row) => ({ value: row.employeeid, label: fullName(peopleById.get(row.employeeid) ?? { personid: row.employeeid }) }))
  };
}
function clientOptionsFromRows(rows) { return rows.map(({ client, person }) => ({ value: client.clientid, label: `${fullName(person)} · #${client.clientid}` })); }
function personOptionsFromRows(rows) { return rows.map((person) => ({ value: person.personid, label: `${fullName(person)} · #${person.personid}` })); }
function roomOptionsFromRows(rows) { return rows.map((room) => ({ value: room.roomnumber, label: `${room.roomname || "Room"} · #${room.roomnumber}` })); }

function setRecordArea(html) { recordFormArea.innerHTML = html; }
async function renderRecordForm(mode, selectedID = "") {
  if (!currentSession || !currentRole) return;
  const token = ++recordLoadToken;
  clearGlobalNotice();
  const counselorModes = ["edit_appointment_notes", "edit_scheduledfor"];
  const schedulerModes = ["new_client", "edit_client", "new_appointment", "edit_appointment", "edit_scheduledfor", "edit_person", "new_room", "edit_room", "edit_employee"];
  if (mode && !(isAdmin() || (isCounselor() && counselorModes.includes(mode)) || (currentRole === "raft_scheduler" && schedulerModes.includes(mode)))) {
    setRecordHeading("ACCESS RESTRICTED", "This action is not available to your role");
    setRecordArea(`<div class="result-empty">Only the actions granted to your signed-in role are available here.</div>`);
    return;
  }
  setRecordHeading("RECORD DETAILS", "Loading form…");
  setRecordArea(`<div class="record-empty"><span class="spinner"></span><strong>Loading the fields allowed for your role…</strong></div>`);
  try {
    if (mode === "new_client" || mode === "edit_client") await renderClientRecordForm(mode, selectedID, token);
    else if (mode === "new_appointment" || mode === "edit_appointment") await renderAppointmentRecordForm(mode, selectedID, token);
    else if (mode === "edit_scheduledfor") await renderScheduledForForm(selectedID, token);
    else if (mode === "edit_appointment_notes") await renderAppointmentNotesForm(selectedID, token);
    else if (mode === "edit_person") await renderPersonForm(selectedID, token);
    else if (mode === "new_room" || mode === "edit_room") await renderRoomForm(mode, selectedID, token);
    else if (mode === "edit_employee") await renderEmployeeForm(selectedID, token);
    else {
      setRecordHeading("RECORD DETAILS", "Select an action to begin");
      setRecordArea(`<div class="record-empty"><div class="empty-detail-icon">＋</div><strong>Ready when you are</strong><span>Pick an action from the left to load the form.</span></div>`);
    }
  } catch (error) {
    if (token !== recordLoadToken) return;
    setRecordHeading("RECORD DETAILS", "Form unavailable");
    setRecordArea(`<div class="result-empty">${escapeHtml(sayError(error))}</div>`);
  }
}

function contactFields(person = {}) {
  return `${field("First name", "firstname", { value: person.firstname ?? "", maxLength: "50", required: true })}${field("Last name", "lastname", { value: person.lastname ?? "", maxLength: "50", required: true })}${field("Email", "email", { type: "email", value: person.email ?? "", maxLength: "100" })}${field("Phone", "phone", { type: "tel", value: person.phone ?? "", maxLength: "14", placeholder: "(555) 555-5555" })}${field("Street address", "address", { value: person.address ?? "", maxLength: "50", full: true })}${field("City", "city", { value: person.city ?? "", maxLength: "50" })}${field("State", "state", { value: person.state ?? "", maxLength: "2", placeholder: "UT" })}${field("ZIP", "zip", { value: person.zip ?? "", maxLength: "10" })}`;
}
function clientFields(client = {}, people = [], mode = "new_client") {
  const referralOptions = people.filter(({ client: candidate }) => candidate.clientid !== client.clientid).map(({ client: candidate, person }) => ({ value: candidate.clientid, label: `${fullName(person)} · #${candidate.clientid}` }));
  return `<div class="form-separator">Contact information</div>${contactFields(client.person)}<div class="form-separator">Client details</div>${field("How they found RAFT", "foundout", { value: client.foundout ?? "", maxLength: "50" })}${field("Reminder method", "remindermethod", { value: client.remindermethod ?? "", maxLength: "50" })}${field("Referred by client", "referredby", { type: "select", options: referralOptions, value: client.referredby ?? "", placeholder: "No referral recorded" })}`;
}
function clientTargetField(rows, selectedID = "") {
  return field("Select client", "targetid", { type: "select", options: clientOptionsFromRows(rows), value: selectedID, required: true, full: true, placeholder: "Choose a client…" });
}
async function renderClientRecordForm(mode, selectedID, token) {
  const rows = await loadClientOptions();
  if (token !== recordLoadToken) return;
  if (mode === "new_client") {
    setRecordHeading("NEW CLIENT", "Add a client");
    setRecordArea(`<form class="record-form" data-record-form="new_client">${clientFields({}, rows)}${saveFooter("Add client")}</form>`);
    return;
  }
  setRecordHeading("CLIENT DETAILS", "Edit a client");
  if (selectedID) {
    const selected = rows.find(({ client }) => String(client.clientid) === String(selectedID));
    if (selected) {
      if (token !== recordLoadToken) return;
      setRecordArea(`<form class="record-form" data-record-form="edit_client">${clientTargetField(rows, selectedID)}<div class="form-separator">Contact information</div>${contactFields(selected.person)}<div class="form-separator">Client details</div>${field("How they found RAFT", "foundout", { value: selected.client.foundout ?? "", maxLength: "50" })}${field("Reminder method", "remindermethod", { value: selected.client.remindermethod ?? "", maxLength: "50" })}${field("Referred by client", "referredby", { type: "select", options: rows.filter(({ client }) => String(client.clientid) !== String(selectedID)).map(({ client, person }) => ({ value: client.clientid, label: `${fullName(person)} · #${client.clientid}` })), value: selected.client.referredby ?? "", placeholder: "No referral recorded" })}${saveFooter("Save client")}</form>`);
      return;
    }
  }
  setRecordArea(`<form class="record-form" data-record-form="edit_client">${clientTargetField(rows, selectedID)}<div class="form-field full field-help">Choose a client above to load their current details.</div>${saveFooter("Save client")}</form>`);
}

function appointmentFields(appointment = {}, staff = {}, rooms = [], clients = [], includeClientLinks = false, isNew = false) {
  const roomOptions = roomOptionsFromRows(rooms);
  const clientChoices = clientOptionsFromRows(clients);
  let markup = `${field("Appointment date and time", "appointmenttime", { type: "datetime-local", value: dateTimeLocalValue(appointment.appointmenttime), required: true })}${field("Duration (minutes)", "duration", { type: "number", value: appointment.duration ?? "", min: "1", step: "1", required: true })}${field("Counselor", "counselorid", { type: "select", options: staff.counselors, value: appointment.counselorid ?? "", required: true })}${field("Assigned employee", "employeeid", { type: "select", options: staff.employees, value: appointment.employeeid ?? "", required: true })}${field("Room", "roomnumber", { type: "select", options: roomOptions, value: appointment.roomnumber ?? "", required: true })}`;
  if (includeClientLinks) markup += `<div class="form-separator">Clients for this appointment</div>${field("Clients", "clientIds", { type: "select", options: clientChoices, full: true, multiple: true, placeholder: "Select one or more clients", help: "Use Ctrl/Cmd to select more than one. Existing links cannot be deleted." })}`;
  if (isAdmin()) {
    markup += `<div class="form-separator">Private details · Admin only</div>${field("Appointment notes", "notes", { type: "textarea", value: appointment.notes ?? "", maxLength: "3000", full: true, rows: 3 })}`;
    if (includeClientLinks) markup += field("Assignment for each selected client", "assignment", { type: "textarea", maxLength: "2000", full: true, rows: 2, help: "This value is saved on each selected ScheduledFor record." });
  }
  return markup;
}
async function renderAppointmentRecordForm(mode, selectedID, token) {
  const [staff, rooms, clients] = await Promise.all([loadStaffOptions(), loadRoomOptions(), loadClientOptions()]);
  if (token !== recordLoadToken) return;
  const apptColumns = isAdmin() ? `${BASE_APPOINTMENT_COLUMNS},notes` : BASE_APPOINTMENT_COLUMNS;
  if (mode === "new_appointment") {
    setRecordHeading("NEW APPOINTMENT", "Schedule an appointment");
    setRecordArea(`<form class="record-form" data-record-form="new_appointment">${appointmentFields({}, staff, rooms, clients, true, true)}${saveFooter("Add appointment")}</form>`);
    return;
  }
  const appointments = await result(supabase.from("appointment").select(apptColumns).order("appointmenttime", { ascending: false }).limit(1000));
  if (token !== recordLoadToken) return;
  const appointmentOptions = (appointments ?? []).map((appointment) => ({ value: appointment.appointmentid, label: `#${appointment.appointmentid} · ${appointmentDateLabel(appointment.appointmenttime)} · ${appointment.duration ?? "—"} min` }));
  const target = field("Select appointment", "targetid", { type: "select", options: appointmentOptions, value: selectedID, required: true, full: true, placeholder: "Choose an appointment…" });
  const appointment = appointments?.find((row) => String(row.appointmentid) === String(selectedID));
  setRecordHeading("APPOINTMENT DETAILS", "Edit an appointment");
  if (!appointment) {
    setRecordArea(`<form class="record-form" data-record-form="edit_appointment">${target}<div class="form-field full field-help">Choose an appointment above to load its schedule details.</div>${saveFooter("Save appointment")}</form>`);
    return;
  }
  setRecordArea(`<form class="record-form" data-record-form="edit_appointment">${target}<div class="form-separator">Schedule details</div>${appointmentFields(appointment, staff, rooms, clients, false, false)}${saveFooter("Save appointment")}</form>`);
}

async function scheduledForRows() {
  const columns = canSeeAssignment() ? "appointmentid,clientid,assignment,kept" : "appointmentid,clientid,kept";
  const links = await result(supabase.from("scheduledfor").select(columns).order("appointmentid", { ascending: false }).limit(1500));
  const apptIDs = [...new Set((links ?? []).map((link) => link.appointmentid))];
  const clientIDs = [...new Set((links ?? []).map((link) => link.clientid))];
  const [appts, clients] = await Promise.all([
    apptIDs.length ? result(supabase.from("appointment").select("appointmentid,appointmenttime").in("appointmentid", apptIDs)) : Promise.resolve([]),
    clientIDs.length ? loadClientOptions() : Promise.resolve([])
  ]);
  const apptMap = new Map((appts ?? []).map((appt) => [appt.appointmentid, appt]));
  const clientMap = new Map((clients ?? []).map(({ client, person }) => [client.clientid, person]));
  return (links ?? []).map((link) => {
    const appointment = apptMap.get(link.appointmentid);
    const person = clientMap.get(link.clientid);
    return { ...link, label: `Appt #${link.appointmentid} · ${appointment ? appointmentDateLabel(appointment.appointmenttime) : "Time not set"} · ${person ? fullName(person) : `Client #${link.clientid}`}` };
  });
}
async function renderScheduledForForm(selectedKey, token) {
  const rows = await scheduledForRows();
  if (token !== recordLoadToken) return;
  const selected = rows.find((row) => `${row.appointmentid}:${row.clientid}` === selectedKey);
  const options = rows.map((row) => ({ value: `${row.appointmentid}:${row.clientid}`, label: row.label }));
  const target = field("Select client appointment", "targetkey", { type: "select", options, value: selectedKey, required: true, full: true, placeholder: "Choose an appointment and client…" });
  const detailFields = selected ? `${canSeeAssignment() ? field("Assignment", "assignment", { type: "textarea", value: selected.assignment ?? "", maxLength: "2000", full: true, rows: 3 }) : ""}${field("Visit kept", "kept", { type: "select", value: selected.kept === true ? "true" : selected.kept === false ? "false" : "", options: [{ value: "true", label: "Yes" }, { value: "false", label: "No" }], placeholder: "Not marked" })}` : `<div class="form-field full field-help">Choose a linked client visit to load the fields allowed for your role.</div>`;
  setRecordHeading("CLIENT APPOINTMENT DETAILS", "Update a client visit");
  setRecordArea(`<form class="record-form" data-record-form="edit_scheduledfor">${target}${detailFields}${saveFooter("Save visit details")}</form>`);
}

async function renderAppointmentNotesForm(selectedID, token) {
  const appointments = await result(supabase.from("appointment").select("appointmentid,appointmenttime,notes").order("appointmenttime", { ascending: false }).limit(1000));
  if (token !== recordLoadToken) return;
  const options = (appointments ?? []).map((appointment) => ({ value: appointment.appointmentid, label: `#${appointment.appointmentid} · ${appointmentDateLabel(appointment.appointmenttime)}` }));
  const appointment = appointments?.find((row) => String(row.appointmentid) === String(selectedID));
  setRecordHeading("COUNSELOR UPDATE", "Update appointment notes");
  const target = field("Select appointment", "targetid", { type: "select", options, value: selectedID, required: true, full: true, placeholder: "Choose an appointment…" });
  const notes = appointment ? field("Appointment notes", "notes", { type: "textarea", value: appointment.notes ?? "", maxLength: "3000", full: true, rows: 5 }) : `<div class="form-field full field-help">Choose an appointment to load its notes.</div>`;
  setRecordArea(`<form class="record-form" data-record-form="edit_appointment_notes">${target}${notes}${saveFooter("Save notes")}</form>`);
}

async function renderPersonForm(selectedID, token) {
  const people = await loadPersonOptions();
  if (token !== recordLoadToken) return;
  const person = people.find((row) => String(row.personid) === String(selectedID));
  const target = field("Select person", "targetid", { type: "select", options: personOptionsFromRows(people), value: selectedID, required: true, full: true, placeholder: "Choose a person…" });
  setRecordHeading("CONTACT INFORMATION", "Edit contact details");
  if (!person) {
    setRecordArea(`<form class="record-form" data-record-form="edit_person">${target}<div class="form-field full field-help">Choose a person to load their contact details.</div>${saveFooter("Save contact details")}</form>`);
    return;
  }
  setRecordArea(`<form class="record-form" data-record-form="edit_person">${target}<div class="form-separator">Contact information</div>${contactFields(person)}${saveFooter("Save contact details")}</form>`);
}

async function renderRoomForm(mode, selectedID, token) {
  const rooms = await loadRoomOptions();
  if (token !== recordLoadToken) return;
  if (mode === "new_room") {
    setRecordHeading("NEW ROOM", "Add a room");
    setRecordArea(`<form class="record-form" data-record-form="new_room">${field("Room number", "roomnumber", { type: "number", min: "1", step: "1", required: true })}${field("Room name", "roomname", { maxLength: "50", required: true })}${saveFooter("Add room")}</form>`);
    return;
  }
  const options = roomOptionsFromRows(rooms);
  const room = rooms.find((row) => String(row.roomnumber) === String(selectedID));
  const target = field("Select room", "targetid", { type: "select", options, value: selectedID, required: true, full: true, placeholder: "Choose a room…" });
  setRecordHeading("ROOM DETAILS", "Edit a room");
  if (!room) {
    setRecordArea(`<form class="record-form" data-record-form="edit_room">${target}<div class="form-field full field-help">Choose a room to load its details.</div>${saveFooter("Save room")}</form>`);
    return;
  }
  setRecordArea(`<form class="record-form" data-record-form="edit_room">${target}${field("Room name", "roomname", { value: room.roomname ?? "", maxLength: "50", required: true })}${saveFooter("Save room")}</form>`);
}

async function renderEmployeeForm(selectedID, token) {
  const employeeColumns = isAdmin() ? "employeeid,datehired,wage,supervisorid" : "employeeid,datehired,supervisorid";
  const [employees, people] = await Promise.all([
    result(supabase.from("employee").select(employeeColumns).order("employeeid", { ascending: true })),
    loadPersonOptions()
  ]);
  if (token !== recordLoadToken) return;
  const peopleByID = new Map(people.map((person) => [person.personid, person]));
  const employeeOptions = (employees ?? []).map((employee) => ({ value: employee.employeeid, label: `${fullName(peopleByID.get(employee.employeeid) ?? { personid: employee.employeeid })} · #${employee.employeeid}` }));
  const employee = employees.find((row) => String(row.employeeid) === String(selectedID));
  const target = field("Select employee", "targetid", { type: "select", options: employeeOptions, value: selectedID, required: true, full: true, placeholder: "Choose an employee…" });
  const supervisors = (employees ?? []).map((item) => ({ value: item.employeeid, label: fullName(peopleByID.get(item.employeeid) ?? { personid: item.employeeid }) }));
  setRecordHeading(isAdmin() ? "ADMIN · EMPLOYEE" : "EMPLOYEE", "Edit employee details");
  if (!employee) {
    setRecordArea(`<form class="record-form" data-record-form="edit_employee">${target}<div class="form-field full field-help">${isAdmin() ? "Employee wage is available in this Admin form." : "Employee wage is hidden for your role."}</div>${saveFooter("Save employee")}</form>`);
    return;
  }
  const wageField = isAdmin() ? field("Wage", "wage", { type: "number", value: employee.wage ?? "", min: "0", max: "99.99", step: "0.01", required: true, help: "Hourly wage stored in the existing Employee.Wage column." }) : "";
  setRecordArea(`<form class="record-form" data-record-form="edit_employee">${target}${field("Date hired", "datehired", { type: "date", value: dateValue(employee.datehired) })}${wageField}${field("Supervisor", "supervisorid", { type: "select", options: supervisors, value: employee.supervisorid, required: true })}${saveFooter("Save employee")}</form>`);
}

async function handleRecordSubmit(event) {
  const form = event.target.closest("form[data-record-form]");
  if (!form) return;
  event.preventDefault();
  if (!currentRole || !currentSession) return;
  const mode = form.dataset.recordForm;
  const button = $("button[type=submit]", form);
  setButtonBusy(button, true);
  setFormStatus(form, "Saving…");
  try {
    if (mode === "new_client") await saveNewClient(form);
    else if (mode === "edit_client") await saveEditClient(form);
    else if (mode === "new_appointment") await saveNewAppointment(form);
    else if (mode === "edit_appointment") await saveEditAppointment(form);
    else if (mode === "edit_scheduledfor") await saveScheduledFor(form);
    else if (mode === "edit_appointment_notes") await saveAppointmentNotes(form);
    else if (mode === "edit_person") await savePerson(form);
    else if (mode === "new_room") await saveNewRoom(form);
    else if (mode === "edit_room") await saveRoom(form);
    else if (mode === "edit_employee") await saveEmployee(form);
    setFormStatus(form, "Saved to the RAFT database.", "success");
    const targetID = formValue(form, "targetid");
    if (["edit_client", "edit_appointment", "edit_appointment_notes", "edit_scheduledfor", "edit_person", "edit_room", "edit_employee"].includes(mode) && targetID) {
      await renderRecordForm(mode, targetID);
    }
    if (mode === "new_client") await renderRecordForm("new_client");
    if (mode === "new_appointment") await renderRecordForm("new_appointment");
    if (mode === "new_room") await renderRecordForm("new_room");
    if (activeScreen === "home") loadHome();
    if (activeScreen === "dashboard") loadDashboard();
    showGlobalNotice("Record saved successfully.", "success");
  } catch (error) {
    setFormStatus(form, sayError(error), "error");
    showGlobalNotice(sayError(error), "error");
  } finally {
    if (button.isConnected) setButtonBusy(button, false);
  }
}

async function saveNewClient(form) {
  const person = Object.fromEntries(["firstname", "lastname", "email", "phone", "address", "city", "state", "zip"].map((key) => [key, blankNull(formValue(form, key))]));
  const created = await result(supabase.from("person").insert(person).select("personid").single());
  const client = { clientid: created.personid, foundout: blankNull(formValue(form, "foundout")), remindermethod: blankNull(formValue(form, "remindermethod")), referredby: numericOrNull(formValue(form, "referredby")) };
  try {
    await result(supabase.from("client").insert(client));
  } catch (error) {
    throw new Error(`Contact Person #${created.personid} was saved, but the Client row failed: ${sayError(error)}`);
  }
}
async function saveEditClient(form) {
  const id = Number(formValue(form, "targetid"));
  if (!id) throw new Error("Choose a client before saving.");
  const person = Object.fromEntries(["firstname", "lastname", "email", "phone", "address", "city", "state", "zip"].map((key) => [key, blankNull(formValue(form, key))]));
  await result(supabase.from("person").update(person).eq("personid", id));
  try {
    await result(supabase.from("client").update({ foundout: blankNull(formValue(form, "foundout")), remindermethod: blankNull(formValue(form, "remindermethod")), referredby: numericOrNull(formValue(form, "referredby")) }).eq("clientid", id));
  } catch (error) {
    throw new Error(`Contact details were saved, but the Client details row failed: ${sayError(error)}`);
  }
}
function appointmentPayload(form, mode) {
  const payload = {
    appointmenttime: blankNull(formValue(form, "appointmenttime"))?.replace("T", " ") ?? null,
    duration: numericOrNull(formValue(form, "duration")),
    counselorid: numericOrNull(formValue(form, "counselorid")),
    employeeid: numericOrNull(formValue(form, "employeeid")),
    roomnumber: numericOrNull(formValue(form, "roomnumber"))
  };
  if (isAdmin()) payload.notes = blankNull(formValue(form, "notes"));
  return payload;
}
async function saveNewAppointment(form) {
  const payload = appointmentPayload(form, "new");
  const created = await result(supabase.from("appointment").insert(payload).select("appointmentid").single());
  const clientIDs = [...new Set(new FormData(form).getAll("clientIds").map(Number).filter(Boolean))];
  if (clientIDs.length) {
    const links = clientIDs.map((clientid) => {
      const link = { appointmentid: created.appointmentid, clientid, kept: null };
      if (canSeeAssignment()) link.assignment = blankNull(formValue(form, "assignment"));
      return link;
    });
    try {
      await result(supabase.from("scheduledfor").insert(links));
    } catch (error) {
      throw new Error(`Appointment #${created.appointmentid} was saved, but its client links failed: ${sayError(error)}`);
    }
  }
}
async function saveEditAppointment(form) {
  const id = Number(formValue(form, "targetid"));
  if (!id) throw new Error("Choose an appointment before saving.");
  await result(supabase.from("appointment").update(appointmentPayload(form, "edit")).eq("appointmentid", id));
}
async function saveScheduledFor(form) {
  const [appointmentID, clientID] = String(formValue(form, "targetkey") ?? "").split(":").map(Number);
  if (!appointmentID || !clientID) throw new Error("Choose a client appointment before saving.");
  const payload = { kept: formValue(form, "kept") === "" ? null : formValue(form, "kept") === "true" };
  if (canSeeAssignment()) payload.assignment = blankNull(formValue(form, "assignment"));
  await result(supabase.from("scheduledfor").update(payload).eq("appointmentid", appointmentID).eq("clientid", clientID));
}
async function saveAppointmentNotes(form) {
  const id = Number(formValue(form, "targetid"));
  if (!id) throw new Error("Choose an appointment before saving.");
  await result(supabase.from("appointment").update({ notes: blankNull(formValue(form, "notes")) }).eq("appointmentid", id));
}
async function savePerson(form) {
  const id = Number(formValue(form, "targetid"));
  if (!id) throw new Error("Choose a person before saving.");
  const payload = Object.fromEntries(["firstname", "lastname", "email", "phone", "address", "city", "state", "zip"].map((key) => [key, blankNull(formValue(form, key))]));
  await result(supabase.from("person").update(payload).eq("personid", id));
}
async function saveNewRoom(form) {
  await result(supabase.from("room").insert({ roomnumber: Number(formValue(form, "roomnumber")), roomname: blankNull(formValue(form, "roomname")) }));
}
async function saveRoom(form) {
  const id = Number(formValue(form, "targetid"));
  if (!id) throw new Error("Choose a room before saving.");
  await result(supabase.from("room").update({ roomname: blankNull(formValue(form, "roomname")) }).eq("roomnumber", id));
}
async function saveEmployee(form) {
  if (!isAdmin() && currentRole !== "raft_scheduler") throw new Error("This action is not available to your role.");
  const id = Number(formValue(form, "targetid"));
  if (!id) throw new Error("Choose an employee before saving.");
  const payload = { datehired: blankNull(formValue(form, "datehired")), supervisorid: numericOrNull(formValue(form, "supervisorid")) };
  if (isAdmin()) payload.wage = numericOrNull(formValue(form, "wage"));
  await result(supabase.from("employee").update(payload).eq("employeeid", id));
}

function authMessage(error) {
  const text = error?.message ?? "";
  if (/invalid login credentials|invalid_credentials|email not confirmed/i.test(text)) return "That email or password isn’t correct. Please try again.";
  if (/rate limit/i.test(text)) return "Too many sign-in attempts. Wait a moment and try again.";
  return text || "Unable to sign in. Please check your connection and try again.";
}

signInForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  signInError.hidden = true;
  signInError.textContent = "";
  const submitButton = signInButton;
  setButtonBusy(submitButton, true, "Signing in…");
  try {
    const email = String(formValue(signInForm, "email") ?? "").trim();
    const password = String(formValue(signInForm, "password") ?? "");
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await applySession(data.session);
  } catch (error) {
    signInError.textContent = authMessage(error);
    signInError.hidden = false;
  } finally {
    setButtonBusy(submitButton, false);
  }
});

async function signOut() {
  try { await supabase.auth.signOut(); }
  catch (error) { showGlobalNotice(sayError(error), "error"); }
  showSignIn();
}
$("#sign-out-button").addEventListener("click", signOut);
$("#mobile-sign-out").addEventListener("click", signOut);

$("#main-nav").addEventListener("click", (event) => {
  const button = event.target.closest("[data-screen]");
  if (button) setScreen(button.dataset.screen);
});
staffApp.addEventListener("click", (event) => {
  const destination = event.target.closest("[data-go]");
  if (destination) {
    if (destination.dataset.recordMode && recordAction.querySelector(`option[value="${destination.dataset.recordMode}"]`)) {
      recordAction.value = destination.dataset.recordMode;
    }
    setScreen(destination.dataset.go);
  }
  const clientButton = event.target.closest("[data-client-id]");
  if (clientButton) loadClientDetail(clientButton.dataset.clientId);
});

$("#client-search-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const token = ++clientSearchToken;
  const term = String(formValue(event.currentTarget, "query") ?? "").trim();
  const message = $("#client-search-message");
  if (!term) {
    message.textContent = "Enter a name, phone, email, or client ID to search.";
    message.className = "inline-message muted";
    return;
  }
  message.textContent = "Searching client records…";
  message.className = "inline-message muted";
  $("#client-results").innerHTML = `<div class="loading-row"><span class="spinner"></span> Searching…</div>`;
  $("#client-detail").innerHTML = `<div class="empty-detail"><div class="empty-detail-icon">⌕</div><strong>Choose a client</strong><span>Client details will appear here.</span></div>`;
  selectedClientID = null;
  try {
    const rows = await searchClients(term);
    if (token !== clientSearchToken || !currentSession || !currentRole) return;
    searchRows = rows;
    renderClientResults(searchRows);
    message.textContent = `${searchRows.length} client${searchRows.length === 1 ? "" : "s"} found.`;
    if (!searchRows.length) message.textContent = "No client records matched that search.";
    if (searchRows.length === 1) loadClientDetail(searchRows[0].client.clientid);
  } catch (error) {
    if (token !== clientSearchToken || !currentSession || !currentRole) return;
    searchRows = [];
    $("#client-results").innerHTML = `<div class="result-empty">${escapeHtml(sayError(error))}</div>`;
    message.textContent = "Search could not be completed.";
    message.className = "inline-message error";
  }
});
$("#client-search-form").addEventListener("reset", () => {
  clientSearchToken++;
  window.setTimeout(() => {
    searchRows = [];
    selectedClientID = null;
    $("#client-results").replaceChildren();
    $("#client-detail").innerHTML = `<div class="empty-detail"><div class="empty-detail-icon">⌕</div><strong>Client details will appear here</strong><span>Choose a person from your search results.</span></div>`;
    $("#client-search-message").textContent = "Start typing to find a client record.";
  }, 0);
});

recordAction.addEventListener("change", () => renderRecordForm(recordAction.value));
recordFormArea.addEventListener("submit", handleRecordSubmit);
recordFormArea.addEventListener("change", (event) => {
  const form = event.target.closest("form[data-record-form]");
  if (!form || event.target.name !== "targetid" && event.target.name !== "targetkey") return;
  const mode = form.dataset.recordForm;
  const id = event.target.value;
  if (mode === "edit_scheduledfor") renderRecordForm(mode, id);
  else if (["edit_client", "edit_appointment", "edit_appointment_notes", "edit_person", "edit_room", "edit_employee"].includes(mode)) renderRecordForm(mode, id);
});

const { data: authSubscription } = supabase.auth.onAuthStateChange((_event, session) => {
  queueMicrotask(() => applySession(session));
});
void authSubscription;
supabase.auth.getSession().then(({ data, error }) => {
  if (error) {
    showSignIn("Unable to restore your session. Please sign in again.");
    return;
  }
  applySession(data.session);
}).catch(() => showSignIn("Unable to restore your session. Please sign in again."));
window.raftFrontDeskLoaded = true;
