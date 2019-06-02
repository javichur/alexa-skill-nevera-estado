/* eslint-disable  func-names */
/* eslint-disable  no-console */

/* Skill "Nevera estado".
 * Creada por Javier Campos (https://javiercampos.es).
 * 21/2/2019
*/

// NOTA: Las funciones Lambda funcionan con timezone UTC.

/* 1. Cargamos las dependencias. */
const Alexa = require('ask-sdk-core');

const dynamola = require('dynamola');
let myDb = new dynamola("skill-alexa-la-nevera-2", "userId", "productName"); // editar según tu tabla DynamoDB
const NOMBRE_NEVERA_GENERICA = "casa";
const ATTR_NAME = "productos";



var moment = require('moment-timezone');

const skillBuilder = Alexa.SkillBuilders.custom();

/* 2. Constantes */
const SKILL_NAME = "Nevera estado";
const DIME_POR_EJEMPLO = 'Dime por ejemplo: "meto leche", "abro la mayonesa", "info guacamole", "borra el pollo" o "ver listado". También puedes salir. ¿Qué dices?';
const HELP_MESSAGE = 'Anota aquí la comida que compras, cuándo la abriste y cuándo caduca. ';
const STOP_MESSAGE = '<say-as interpret-as="interjection">Hasta luego</say-as>';
const NO_ENTIENDO_REPITE_POR_FAVOR = '<say-as interpret-as="interjection">¿cómorr?</say-as>. Lo siento, no te he entendido. Repite por favor. ';
const NEVERA_VACIA = "La nevera está vacía. ";
const ERROR_AL_INTENTAR_RECORDAR = "Error al intentar recordar lo que tienes en la nevera. Vuelve a intentarlo. ";
const ERROR_AL_ABRIR_PRODUCTO = "Error al marcar como abierto el producto. Vuelve a intentarlo. ";
const ERROR_AL_BORRAR_PRODUCTO = "Error borrando. Vuelve a intentarlo. ";
const ERROR_INESPERADO = "Ha ocurrido un error. ";

const MILISEGUNDOS_DIARIOS = 86400000; 

/* 3. Manejadores */
const LaunchRequestHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'LaunchRequest';
  },
  async handle(handlerInput) {
    const { requestEnvelope, serviceClientFactory, attributesManager } = handlerInput;    
    const userId = requestEnvelope.context.System.user.userId;

    const timezone = await obtenerTimezoneDeSessionOrApi(requestEnvelope, serviceClientFactory, attributesManager);
    
    const list = await obtenerListaDeSessionOrDB(userId, NOMBRE_NEVERA_GENERICA, ATTR_NAME, attributesManager);
    if(list == null){      
      return msgAndStop(ERROR_AL_INTENTAR_RECORDAR, handlerInput);
    }
    else if(list.length == 0){
      return msgAndTell(NEVERA_VACIA, handlerInput);
    }
    else{
      // generar aviso de caducidad
      const strCaducadosOCasi = buscarCaducadosYProximosCaducados(list, timezone);

      var strTotal = "";
      if(list.length == 1) strTotal = "Hay solo 1 producto en la nevera. ";
      else strTotal = `Hay ${list.length} productos en la nevera. `;

      return msgAndTell(strTotal + strCaducadosOCasi, handlerInput);
    }  
  },
};


const NuevoProductoHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
            && handlerInput.requestEnvelope.request.intent.name === 'NuevoProductoIntent';
  },
  async handle(handlerInput) {       
      
    let nombreProductoSlot = handlerInput.requestEnvelope.request.intent.slots.nombreProducto.value;
    nombreProductoSlot = nombreProductoSlot.toLowerCase();
    
    const fechaCaducidadSlot = handlerInput.requestEnvelope.request.intent.slots.fechaCaducidad.value;
    const userId = handlerInput.requestEnvelope.context.System.user.userId;

    const { requestEnvelope, serviceClientFactory, attributesManager } = handlerInput;    
    const timezone = await obtenerTimezoneDeSessionOrApi(requestEnvelope, serviceClientFactory, attributesManager);

    let list = await obtenerListaDeSessionOrDB(userId, NOMBRE_NEVERA_GENERICA, ATTR_NAME, attributesManager);
    if(list == null){      
      return msgAndStop(ERROR_AL_INTENTAR_RECORDAR, handlerInput);
    }
    else{
      for(var i=0; i<list.length; i++){
        if(list[i].name == nombreProductoSlot){
          
          return handlerInput.responseBuilder
            .speak("Ya hay " + nombreProductoSlot + " en tu nevera. Por favor di otro nombre o di 'borra " + nombreProductoSlot + "'.")
            .reprompt("Por favor di otro nombre o di 'borra " + nombreProductoSlot + "'.")
            .getResponse();
        }
      }      
    }

    // si no está repe...

    const hoyFechaUser = fechaHoyUserToStringYYYYMMDD(timezone);

    var prod = { name: nombreProductoSlot, 
                 fecha_metido: hoyFechaUser,
                 fecha_caducidad_cerrado: fechaCaducidadSlot,
                 fecha_caducidad_abierto: null
                };
    
    list.unshift(prod);

    // actualizar session
    let sessionAttributes = attributesManager.getSessionAttributes();
    sessionAttributes[ATTR_NAME] = list;
    attributesManager.setSessionAttributes(sessionAttributes);
    
    let itemAttributes = {};
    itemAttributes[ATTR_NAME] = list;
    
    // guardar en bbdd. OJO, es con "update"
    return await myDb.updateItemWithPrimarySortKey(userId, NOMBRE_NEVERA_GENERICA, itemAttributes)
      .then((data) => {;
        return msgAndStop(`Guardado ${nombreProductoSlot}, que caduca ${fechaCaducidadSlot}. `, handlerInput);
      })
      .catch((err) => {
        console.log("Error guardando, vuelve a intentarlo. " + err);
        return msgAndStop("Error guardando. Vuelve a intentarlo. ", handlerInput);
      });
  }
};


const QuitarProductoHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
            && handlerInput.requestEnvelope.request.intent.name === 'QuitarProductoIntent';
  },
  async handle(handlerInput) {        

    let nombreProductoSlot = handlerInput.requestEnvelope.request.intent.slots.nombreProducto.value;
    nombreProductoSlot = nombreProductoSlot.toLowerCase();
    const userId = handlerInput.requestEnvelope.context.System.user.userId;

    const { requestEnvelope, serviceClientFactory, attributesManager } = handlerInput;    

    let list = await obtenerListaDeSessionOrDB(userId, NOMBRE_NEVERA_GENERICA, ATTR_NAME, attributesManager);
    if(list == null){      
      return msgAndStop(ERROR_AL_INTENTAR_RECORDAR, handlerInput);
    }
    else{
      let encontradoQ = false;
      for(var i=0; i<list.length; i++){
        if(list[i].name == nombreProductoSlot){
          encontradoQ = true;
          list.splice(i, 1); // elimina item
          break;          
        }
      }

      if(encontradoQ == false){
        return handlerInput.responseBuilder
            .speak("No he encontrado " + nombreProductoSlot + " en tu nevera. Di 'borrar' y el nombre del producto que quieras borrar.")
            .reprompt("Di 'borrar' y el nombre del producto que quieras borrar.")
            .getResponse();
      }

      // actualizar session
      let sessionAttributes = attributesManager.getSessionAttributes();
      sessionAttributes[ATTR_NAME] = list;
      attributesManager.setSessionAttributes(sessionAttributes);
      
      let itemAttributes = {};
      itemAttributes[ATTR_NAME] = list;
      
      // guardar en bbdd. OJO! es con update.
      return await myDb.updateItemWithPrimarySortKey(userId, NOMBRE_NEVERA_GENERICA, itemAttributes)
        .then((data) => {
          return msgAndStop(`Eliminado ${nombreProductoSlot}. `, handlerInput);
        })
        .catch((err) => {
          console.log("Error eliminando. " + err);
          return msgAndStop(ERROR_AL_BORRAR_PRODUCTO, handlerInput);
        });
      
    }

  },
};


const InfoProductoHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
            && handlerInput.requestEnvelope.request.intent.name === 'InfoProductoIntent';
  },
  async handle(handlerInput) {        

    let nombreProductoSlot = handlerInput.requestEnvelope.request.intent.slots.nombreProducto.value;
    nombreProductoSlot = nombreProductoSlot.toLowerCase();
    const userId = handlerInput.requestEnvelope.context.System.user.userId;

    const { requestEnvelope, serviceClientFactory, attributesManager } = handlerInput;    

    let list = await obtenerListaDeSessionOrDB(userId, NOMBRE_NEVERA_GENERICA, ATTR_NAME, attributesManager);
    if(list == null){      
      return msgAndStop(ERROR_AL_INTENTAR_RECORDAR, handlerInput);
    }
    else{
      const timezone = await obtenerTimezoneDeSessionOrApi(requestEnvelope, serviceClientFactory, attributesManager);
      let encontradoQ = false;
      for(var i=0; i<list.length; i++){
        if(list[i].name == nombreProductoSlot){
          encontradoQ = true;
          var cuandoAbierto = fechaStringToVoiceString(list[i].fecha_abierto, timezone);
          var cuandoMetido = fechaStringToVoiceString(list[i].fecha_metido, timezone);
          var cuandoCaducidadCerrado = fechaStringToVoiceString(list[i].fecha_caducidad_cerrado, timezone);
          var str = `${list[i].name} `;
          str += conjugarVerbo(cuandoMetido.compare, "se metió", "se ha metido", null) + " ";  
          str += cuandoMetido.string + ", ";    

          if(list[i].fecha_abierto == null){
            str+= "está cerrado y ";
            str += conjugarVerbo(cuandoCaducidadCerrado.compare, "caducó", "caduca", "caducará") + " ";
            str += cuandoCaducidadCerrado.string + ". ";
          }
          else{
            var cuandoCaducidadAbierto = fechaStringToVoiceString(list[i].fecha_caducidad_abierto, timezone);
            str+= conjugarVerbo(cuandoAbierto.compare, "se abrió", "se ha abierto", null) + " ";
            str += cuandoAbierto.string + " y ";
            str += conjugarVerbo(cuandoCaducidadAbierto.compare, "caducó", "caduca", "caducará") + " ";
            str += cuandoCaducidadAbierto.string + ". ";
          }

          return msgAndTell(str, handlerInput);        
        }
      }

      if(encontradoQ == false){
        let str = "Producto " + nombreProductoSlot + " no encontrado. Di 'info' y el nombre del producto.";
        return msgAndTell(str, handlerInput);
      }
    }
  },
};


const AbrirProductoHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
            && handlerInput.requestEnvelope.request.intent.name === 'AbrirProductoIntent';
  },
  async handle(handlerInput) {  
    
    let nombreProductoSlot = handlerInput.requestEnvelope.request.intent.slots.nombreProducto.value;
    nombreProductoSlot = nombreProductoSlot.toLowerCase();
    
    const fechaCaducidadAbiertoSlot = handlerInput.requestEnvelope.request.intent.slots.fechaCaducidadAbierto.value;
    const userId = handlerInput.requestEnvelope.context.System.user.userId;

    const { requestEnvelope, serviceClientFactory, attributesManager } = handlerInput;    
    const timezone = await obtenerTimezoneDeSessionOrApi(requestEnvelope, serviceClientFactory, attributesManager);

    let list = await obtenerListaDeSessionOrDB(userId, NOMBRE_NEVERA_GENERICA, ATTR_NAME, attributesManager);
    if(list == null){      
      return msgAndStop(ERROR_AL_INTENTAR_RECORDAR, handlerInput);
    }
    else{
      let encontradoQ = false;
      for(var i=0; i<list.length; i++){
        if(list[i].name == nombreProductoSlot){
          encontradoQ = true;
          break;                 
        }
      }

      if(encontradoQ == false){
        return msgAndTell("No he encontrado " + nombreProductoSlot + " en tu nevera. ", handlerInput);
      }

      // comprobar que fecha abierto <= hoy && fecha abierto <= fecha_caducidad_cerrado
      let strFechaHoyUsuario = fechaHoyUserToStringYYYYMMDD(timezone);
      let t_hoyUser = fechaStringUtcToMilliseconds(strFechaHoyUsuario);
      let t_caducidadAbierto = fechaStringUtcToMilliseconds(fechaCaducidadAbiertoSlot);
      let t_caducidadCerrado = fechaStringUtcToMilliseconds(list[i].fecha_caducidad_cerrado);

      if(t_caducidadAbierto < t_hoyUser){
        return msgAndTell("Ojo, me has dicho una fecha de caducidad ya pasada. No puedo guardarlo. ", handlerInput);
      }
      else if(t_caducidadAbierto > t_caducidadCerrado){
        return msgAndTell(`Ojo, me has dicho una fecha de caducidad posterior a la fecha de caducidad inicial que era ${list[i].fecha_caducidad_cerrado}. Eso no se puede. `, handlerInput);  
      }
      
      // actualizar list
      list[i].fecha_abierto = strFechaHoyUsuario;
      list[i].fecha_caducidad_abierto = fechaCaducidadAbiertoSlot;

      // actualizar session
      let sessionAttributes = attributesManager.getSessionAttributes();
      sessionAttributes[ATTR_NAME] = list;
      attributesManager.setSessionAttributes(sessionAttributes);
      
      let itemAttributes = {};
      itemAttributes[ATTR_NAME] = list;
      
      // guardar en bbdd. OJO! es con update.
      return await myDb.updateItemWithPrimarySortKey(userId, NOMBRE_NEVERA_GENERICA, itemAttributes)
        .then((data) => {
          return msgAndStop(`Abierto ${nombreProductoSlot}, ahora caduca ${fechaCaducidadAbiertoSlot}. `, handlerInput);
        })
        .catch((err) => {
          console.log("Error abriendo producto. " + err);
          return msgAndStop(ERROR_AL_ABRIR_PRODUCTO, handlerInput);
        });
      
    }
  },
};


const ListadoHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
            && handlerInput.requestEnvelope.request.intent.name === 'ListadoIntent';
  },
  async handle(handlerInput) {        

    let userId = handlerInput.requestEnvelope.context.System.user.userId;

    const { requestEnvelope, serviceClientFactory, attributesManager } = handlerInput;    

    let list = await obtenerListaDeSessionOrDB(userId, NOMBRE_NEVERA_GENERICA, ATTR_NAME, attributesManager);
    if(list == null){     
      return msgAndStop(ERROR_AL_INTENTAR_RECORDAR, handlerInput);
    }
    else if(list.length == 0){
      return msgAndTell(NEVERA_VACIA, handlerInput);
    }
    else{
      let speechText = "En la nevera hay: ";
      speechText += listToVoiceString(list, "name");
      speechText += ". ";

      return msgAndTell(speechText, handlerInput);
    }
  },
};


const HelpHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
            && handlerInput.requestEnvelope.request.intent.name === 'AMAZON.HelpIntent';
  },
  handle(handlerInput) {  
    return msgAndTell(HELP_MESSAGE, handlerInput);
  },
};


const FallbackHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && handlerInput.requestEnvelope.request.intent.name === 'AMAZON.FallbackIntent';
  },
  handle(handlerInput) {
    return msgAndTell(NO_ENTIENDO_REPITE_POR_FAVOR, handlerInput);
  },
};


const ExitHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
            && (handlerInput.requestEnvelope.request.intent.name === 'AMAZON.StopIntent'
                || handlerInput.requestEnvelope.request.intent.name === 'AMAZON.CancelIntent');
  },
  handle(handlerInput) {    
    return msgAndStop("", handlerInput);
  },
};


const SessionEndedRequestHandler = {
  canHandle(handlerInput) {
    console.log("Inside SessionEndedRequestHandler");
    return handlerInput.requestEnvelope.request.type === 'SessionEndedRequest';
  },
  handle(handlerInput) {
    var ret = "";
    if(handlerInput.requestEnvelope.request.reason == "ERROR"){
      ret = "La skill se cerró por un error. Lo siento, vuelve a entrar.";
    }
    else if(handlerInput.requestEnvelope.request.reason == "EXCEEDED_MAX_REPROMPTS"){
      ret = "La skill se cerró por falta de respuesta correcta del usuario, vuelve a entrar.";
    }
    else{
      ret = "Se cerró la sesión. Vuelve a entrar.";
    }
    console.log(`Session ended with reason: ${JSON.stringify(handlerInput.requestEnvelope)}`);
    return msgAndStop(ret, handlerInput);
  },
};


const ErrorHandler = {
  canHandle() {
    return true;
  },
  handle(handlerInput, error) {
    console.log(`Error handled: ${error.message}`); // imprimiremos el error por consola    
    
    return msgAndStop(ERROR_INESPERADO, handlerInput);
  },
};


/* 4. Métodos adicionales */
function resumenNevera(listCaducanHoyCerradoOAbierto, listCaducanMananaCerradoOAbierto, 
  listCaducanPasadoMananaCerradoOAbierto, listCaducadoCerradoOAbierto){

  let strResumen = "";
  if(listCaducanHoyCerradoOAbierto.length == 0 && 
    listCaducanMananaCerradoOAbierto.length == 0 &&
    listCaducanPasadoMananaCerradoOAbierto.length == 0){
      strResumen = "Ningún producto caduca en los próximos 2 días. ";
  }
  else{
    strResumen = resumenDeUnTipoDeProducto(listCaducanHoyCerradoOAbierto, "caduca hoy", "caducan hoy");
    strResumen += resumenDeUnTipoDeProducto(listCaducanMananaCerradoOAbierto, "caduca mañana", "caducan mañana");
    strResumen += resumenDeUnTipoDeProducto(listCaducanPasadoMananaCerradoOAbierto, "caduca pasado mañana", "caducan pasado mañana");
  }

  strResumen += resumenDeUnTipoDeProducto(listCaducadoCerradoOAbierto, " ya caducó", "ya caducaron");

  return strResumen;
}


function resumenDeUnTipoDeProducto(list, tipoSingular, tipoPlural){
  if(list.length == 1){
    return `${list[0]} ${tipoSingular}. `;
  }
  else if(list.length > 1){
    return `${list.length} productos ${tipoPlural} (${listToVoiceString(list, null)}). `;
  }
  else return "";
}


function fechaHoyUserToStringYYYYMMDD(timezone){
  return moment().tz(timezone).format('YYYY-MM-DD');
}


const _PASADO = -1;
const _PRESENTE = 0;
const _FUTURO = 1;


function conjugarVerbo(compare, pasado, presente, futuro){
  if (compare == _PRESENTE) return presente;
  else if(compare == _FUTURO) return futuro;
  else return pasado;
}


function fechaStringToVoiceString(strFecha, timezone){
  var f_t = fechaStringUtcToMilliseconds(strFecha);

  var hoy_t = fechaStringUtcToMilliseconds(fechaHoyUserToStringYYYYMMDD(timezone));
  
  if(f_t == hoy_t) return { string: "hoy", compare: _PRESENTE};
  else if(f_t == hoy_t - MILISEGUNDOS_DIARIOS) return { string: "ayer", compare: _PASADO};
  else if(f_t == hoy_t - 2* MILISEGUNDOS_DIARIOS) return { string: "hace 2 días", compare: _PASADO};
  else if(f_t == hoy_t + MILISEGUNDOS_DIARIOS) return { string: "mañana", compare: _FUTURO};
  else if(f_t == hoy_t + 2* MILISEGUNDOS_DIARIOS) return { string: "pasado mañana", compare: _FUTURO};
  else if (f_t > hoy_t) return { string: strFecha, compare: _FUTURO};
  else return { string: strFecha, compare: _PASADO};
}


function fechaStringUtcToMilliseconds(strFecha){
  return new Date(strFecha + "T00:00:00Z").getTime();
}


/**
 * Devuelve string con todos los items de la lista separados por "," menos los 2 últimos que se separan con "y".
 * @param list - listado
 * @param string - attrName, nombre de la propiedad del itme.
 * @return string - string con todos los items de la lista separados por "," menos los 2 últimos que se separan con "y".
 */
function listToVoiceString(list, attrName){
  let ret = "";
  for(var i=0; i< list.length; i++){
    ret += (attrName) ? list[i][attrName] : list[i];
    if(i < list.length - 2) ret += ", ";
    else if (i == list.length -2) ret += " y ";
  }
  return ret;
}


/* Busca 'attrName' en sesión y si lo encuentra lo devuelve.
 * Si no lo encuentra, lo busca en DB, lo guarda en sesión y lo devuelve.
 * Devuelve:
 * - null si error en bbdd.
 * - [] si la lista está vacía.
 * - el array correspondiente si hay datos.
 */
async function obtenerListaDeSessionOrDB(keyValue, sortValue, attrName, attributesManager){

  const sessionAttributes = attributesManager.getSessionAttributes();

  if(sessionAttributes[attrName]){
    return sessionAttributes[attrName];
  }

  return await myDb.getItemWithPrimarySortKey(keyValue, sortValue)
      .then((data) => {
        if(data && data[attrName] /*&& data[attrName].length > 0 */){
          // guardar en sesión (aunque sea array vacío).
          sessionAttributes[attrName] = data[attrName];
          attributesManager.setSessionAttributes(sessionAttributes);
          return data[attrName];
        }
        else{ // si no se encuentra en DB, devuelve array vacío
          return [];
        }        
      })
      .catch((err) => {
        console.log("Error getting attributes: " + err);
        return null; // si error.
      }); 
}


async function obtenerTimezoneDeSessionOrApi(requestEnvelope, serviceClientFactory, attributesManager){

  const sessionAttributes = attributesManager.getSessionAttributes();

  if(sessionAttributes.timezone) return sessionAttributes.timezone;
    
  const deviceId = requestEnvelope.context.System.device.deviceId; 
  const upsServiceClient = serviceClientFactory.getUpsServiceClient();
  const timezone = await upsServiceClient.getSystemTimeZone(deviceId); 

  sessionAttributes.timezone = timezone;
  attributesManager.setSessionAttributes(sessionAttributes);

  return timezone;
}


// Premisa: la fecha de caducidad por apertura será siempre igual o inferior a la fecha de caducidad del envase.
function buscarCaducadosYProximosCaducados(data, timezone){  

  moment.locale('es'); // para que diga meses en castellano.
  
  var hoy_t = fechaStringUtcToMilliseconds(fechaHoyUserToStringYYYYMMDD(timezone));  
  
  let listCaducadoCerradoOAbierto = [];
  let listCaducanHoyCerradoOAbierto = [];
  let listCaducanMananaCerradoOAbierto = [];
  let listCaducanPasadoMananaCerradoOAbierto = [];

  for(var i=0; i<data.length; i++){    
    var fecha_caducidad_cerrado = new Date(data[i].fecha_caducidad_cerrado);    
    var fecha_caducidad_abierto = null;

    if(data[i].fecha_caducidad_abierto != null){
      fecha_caducidad_abierto = new Date(data[i].fecha_caducidad_abierto);   
    }   

    let name = capitalize(data[i].name);

    if(fecha_caducidad_abierto != null && fecha_caducidad_abierto.getTime() <  hoy_t){      
      // caducado por estar abierto  
      listCaducadoCerradoOAbierto.unshift(name);
    }
    else if(fecha_caducidad_abierto != null && fecha_caducidad_abierto.getTime() == hoy_t){
      // abierto y caduca hoy por abierto
      listCaducanHoyCerradoOAbierto.unshift(name);
    }
    else if(fecha_caducidad_abierto != null && fecha_caducidad_abierto.getTime() == hoy_t + MILISEGUNDOS_DIARIOS){
      // abierto y caduca MAÑANA por abierto
      listCaducanMananaCerradoOAbierto.unshift(name);
    }
    else if(fecha_caducidad_abierto != null && fecha_caducidad_abierto.getTime() == hoy_t + 2*MILISEGUNDOS_DIARIOS){
      // abierto y caduca PASADO MAÑANA por abierto    
      listCaducanPasadoMananaCerradoOAbierto.unshift(name);
    }
    else if(fecha_caducidad_cerrado.getTime() < hoy_t){ // caducado según fecha envase                  
      listCaducadoCerradoOAbierto.unshift(name);
    }
    else if(fecha_caducidad_cerrado.getTime() == hoy_t){ // caduca HOY según fecha envase            
      listCaducanHoyCerradoOAbierto.unshift(name);
    }
    else if(fecha_caducidad_cerrado.getTime() == hoy_t + MILISEGUNDOS_DIARIOS){
      // caduca MAÑANA según fecha envase      
      listCaducanMananaCerradoOAbierto.unshift(name);
    }
    else if(fecha_caducidad_cerrado.getTime() == hoy_t + 2*MILISEGUNDOS_DIARIOS){
      // caduca PASADO MAÑANA según fecha envase      
      listCaducanPasadoMananaCerradoOAbierto.unshift(name);
    }
    /* no mostrar info de los productos no caducados. */   
  }

  let strResumen = resumenNevera(listCaducanHoyCerradoOAbierto, listCaducanMananaCerradoOAbierto, 
    listCaducanPasadoMananaCerradoOAbierto, listCaducadoCerradoOAbierto);
  
  return strResumen;
}

function msgAndTell(msg, handlerInput){
  return handlerInput.responseBuilder
          .speak(msg + DIME_POR_EJEMPLO)
          .withSimpleCard(SKILL_NAME, msg)
          .reprompt(msg)
          .getResponse();
}

function msgAndStop(msg, handlerInput){
  return handlerInput.responseBuilder
        .speak(msg + STOP_MESSAGE)
        .withSimpleCard(SKILL_NAME, msg)
        .withShouldEndSession(true)
        .getResponse();
}

function capitalize(string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}


/* 5. Configuración de Lambda */
exports.handler = skillBuilder
  .addRequestHandlers(
    LaunchRequestHandler,
    NuevoProductoHandler,
    QuitarProductoHandler,
    InfoProductoHandler,
    AbrirProductoHandler,
    ListadoHandler,
    HelpHandler,
    ExitHandler,
    FallbackHandler,
    SessionEndedRequestHandler
  )
  .addErrorHandlers(ErrorHandler)
  .withApiClient(new Alexa.DefaultApiClient()) // ServiceClientFactory are only available when you configure the skill instance with an ApiClient. https://ask-sdk-for-nodejs.readthedocs.io/en/latest/Calling-Alexa-Service-APIs.html#serviceclientfactory
  .lambda();