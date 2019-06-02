/* eslint-disable  func-names */
/* eslint-disable  no-console */

/* Skill "Nevera estado".
 * Creada por Javier Campos (https://javiercampos.es).
 * 21/2/2019
*/

// NOTA: Las funciones Lambda funcionan con timezone UTC.

/* 1. Cargamos las dependencias. */
const Alexa = require('ask-sdk-core');

const Dynamola = require('dynamola');

// editar siguientes líneas según tu tabla DynamoDB
const myDb = new Dynamola('skill-alexa-la-nevera-2', 'userId', 'productName');
const NOMBRE_NEVERA_GENERICA = 'casa';
const ATTR_NAME = 'productos';


const moment = require('moment-timezone');

const skillBuilder = Alexa.SkillBuilders.custom();

/* 2. Constantes */
const SKILL_NAME = 'Nevera estado';
const DIME_POR_EJEMPLO = 'Dime por ejemplo: "meto leche", "abro la mayonesa", "info guacamole", "borra el pollo" o "ver listado". También puedes salir. ¿Qué dices?';
const HELP_MESSAGE = 'Anota aquí la comida que compras, cuándo la abriste y cuándo caduca. ';
const STOP_MESSAGE = '<say-as interpret-as="interjection">Hasta luego</say-as>';
const NO_ENTIENDO_REPITE_POR_FAVOR = '<say-as interpret-as="interjection">¿cómorr?</say-as>. Lo siento, no te he entendido. Repite por favor. ';
const NEVERA_VACIA = 'La nevera está vacía. ';
const ERROR_AL_INTENTAR_RECORDAR = 'Error al intentar recordar lo que tienes en la nevera. Vuelve a intentarlo. ';
const ERROR_AL_ABRIR_PRODUCTO = 'Error al marcar como abierto el producto. Vuelve a intentarlo. ';
const ERROR_AL_BORRAR_PRODUCTO = 'Error borrando. Vuelve a intentarlo. ';
const ERROR_INESPERADO = 'Ha ocurrido un error. ';

const MILISEGSDIARIOS = 86400000;

function msgAndTell(msg, handlerInput) {
  return handlerInput.responseBuilder
    .speak(msg + DIME_POR_EJEMPLO)
    .withSimpleCard(SKILL_NAME, msg)
    .reprompt(msg)
    .getResponse();
}

function msgAndStop(msg, handlerInput) {
  return handlerInput.responseBuilder
    .speak(msg + STOP_MESSAGE)
    .withSimpleCard(SKILL_NAME, msg)
    .withShouldEndSession(true)
    .getResponse();
}

function capitalize(string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

/**
 * Devuelve string con todos los items de la lista separados por "," menos los 2 últimos que
 * se separan con "y".
 * @param list - listado
 * @param string - attrName, nombre de la propiedad del itme.
 * @return string - string con todos los items de la lista separados por "," menos los 2 últimos
 * que se separan con "y".
 */
function listToVoiceString(list, attrName) {
  let ret = '';
  for (let i = 0; i < list.length; i += 1) {
    ret += (attrName) ? list[i][attrName] : list[i];
    if (i < list.length - 2) ret += ', ';
    else if (i == list.length - 2) ret += ' y ';
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
async function obtenerListaDeSessionOrDB(keyValue, sortValue, attrName, attributesManager) {
  const sessionAttributes = attributesManager.getSessionAttributes();

  if (sessionAttributes[attrName]) {
    return sessionAttributes[attrName];
  }

  return myDb.getItemWithPrimarySortKey(keyValue, sortValue)
    .then((data) => {
      if (data && data[attrName] /* && data[attrName].length > 0 */) {
        // guardar en sesión (aunque sea array vacío).
        sessionAttributes[attrName] = data[attrName];
        attributesManager.setSessionAttributes(sessionAttributes);
        return data[attrName];
      }
      // si no se encuentra en DB, devuelve array vacío
      return [];
    })
    .catch((err) => {
      console.log(`Error getting attributes: ${err}`);
      return null; // si error.
    });
}

function resumenDeUnTipoDeProducto(list, tipoSingular, tipoPlural) {
  if (list.length == 1) {
    return `${list[0]} ${tipoSingular}. `;
  }
  if (list.length > 1) {
    return `${list.length} productos ${tipoPlural} (${listToVoiceString(list, null)}). `;
  }
  return '';
}

function resumenNevera(listCaducanHoyCerradoOAbierto, listCaducanMananaCerradoOAbierto,
  listCaducanPasadoMananaCerradoOAbierto, listCaducadoCerradoOAbierto) {
  let strResumen = '';
  if (listCaducanHoyCerradoOAbierto.length == 0
    && listCaducanMananaCerradoOAbierto.length == 0
    && listCaducanPasadoMananaCerradoOAbierto.length == 0) {
    strResumen = 'Ningún producto caduca en los próximos 2 días. ';
  } else {
    strResumen = resumenDeUnTipoDeProducto(listCaducanHoyCerradoOAbierto,
      'caduca hoy', 'caducan hoy');
    strResumen += resumenDeUnTipoDeProducto(listCaducanMananaCerradoOAbierto,
      'caduca mañana', 'caducan mañana');
    strResumen += resumenDeUnTipoDeProducto(listCaducanPasadoMananaCerradoOAbierto,
      'caduca pasado mañana', 'caducan pasado mañana');
  }

  strResumen += resumenDeUnTipoDeProducto(listCaducadoCerradoOAbierto,
    ' ya caducó', 'ya caducaron');

  return strResumen;
}

function fechaHoyUserToStringYYYYMMDD(timezone) {
  return moment().tz(timezone).format('YYYY-MM-DD');
}

function fechaStringUtcToMilliseconds(strFecha) {
  return new Date(`${strFecha}T00:00:00Z`).getTime();
}

async function obtenerTimezoneDeSessionOrApi(requestEnvelope, serviceClientFactory, attrManager) {
  const sessionAttributes = attrManager.getSessionAttributes();

  if (sessionAttributes.timezone) return sessionAttributes.timezone;

  const { deviceId } = requestEnvelope.context.System.device;
  const upsServiceClient = serviceClientFactory.getUpsServiceClient();
  const timezone = await upsServiceClient.getSystemTimeZone(deviceId);

  sessionAttributes.timezone = timezone;
  attrManager.setSessionAttributes(sessionAttributes);

  return timezone;
}

/** Premisa: la fecha de caducidad por apertura será siempre igual o inferior a la fecha de
 * caducidad del envase.
 */
function buscarCaducadosYProximosCaducados(data, timezone) {
  moment.locale('es'); // para que diga meses en castellano.

  const hoyTime = fechaStringUtcToMilliseconds(fechaHoyUserToStringYYYYMMDD(timezone));

  const listCaducadoCerradoOAbierto = [];
  const listCaducanHoyCerradoOAbierto = [];
  const listCaducanMananaCerradoOAbierto = [];
  const listCaducanPasadoMananaCerradoOAbierto = [];

  for (let i = 0; i < data.length; i += 1) {
    const fCaducidadCerrado = new Date(data[i].fechaCaducidadCerrado);
    let fCaducidadAbierto = null;

    if (data[i].fechaCaducidadAbierto != null) {
      fCaducidadAbierto = new Date(data[i].fechaCaducidadAbierto);
    }

    const name = capitalize(data[i].name);

    if (fCaducidadAbierto != null && fCaducidadAbierto.getTime() < hoyTime) {
      // caducado por estar abierto
      listCaducadoCerradoOAbierto.unshift(name);
    } else if (fCaducidadAbierto != null && fCaducidadAbierto.getTime() == hoyTime) {
      // abierto y caduca hoy por abierto
      listCaducanHoyCerradoOAbierto.unshift(name);
    } else if (fCaducidadAbierto != null
      && fCaducidadAbierto.getTime() == hoyTime + MILISEGSDIARIOS) {
      // abierto y caduca MAÑANA por abierto
      listCaducanMananaCerradoOAbierto.unshift(name);
    } else if (fCaducidadAbierto != null
      && fCaducidadAbierto.getTime() == hoyTime + 2 * MILISEGSDIARIOS) {
      // abierto y caduca PASADO MAÑANA por abierto
      listCaducanPasadoMananaCerradoOAbierto.unshift(name);
    } else if (fCaducidadCerrado.getTime() < hoyTime) { // caducado según fecha envase
      listCaducadoCerradoOAbierto.unshift(name);
    } else if (fCaducidadCerrado.getTime() == hoyTime) { // caduca HOY según fecha envase
      listCaducanHoyCerradoOAbierto.unshift(name);
    } else if (fCaducidadCerrado.getTime() == hoyTime + MILISEGSDIARIOS) {
      // caduca MAÑANA según fecha envase
      listCaducanMananaCerradoOAbierto.unshift(name);
    } else if (fCaducidadCerrado.getTime() == hoyTime + 2 * MILISEGSDIARIOS) {
      // caduca PASADO MAÑANA según fecha envase
      listCaducanPasadoMananaCerradoOAbierto.unshift(name);
    }
    /* no mostrar info de los productos no caducados. */
  }

  const strResumen = resumenNevera(listCaducanHoyCerradoOAbierto,
    listCaducanMananaCerradoOAbierto,
    listCaducanPasadoMananaCerradoOAbierto,
    listCaducadoCerradoOAbierto);

  return strResumen;
}


/* 3. Manejadores */
const LaunchRequestHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'LaunchRequest';
  },
  async handle(handlerInput) {
    const { requestEnvelope, serviceClientFactory, attributesManager } = handlerInput;
    const { userId } = requestEnvelope.context.System.user;

    const timezone = await obtenerTimezoneDeSessionOrApi(requestEnvelope, serviceClientFactory,
      attributesManager);

    const list = await obtenerListaDeSessionOrDB(userId, NOMBRE_NEVERA_GENERICA, ATTR_NAME,
      attributesManager);
    if (list == null) {
      return msgAndStop(ERROR_AL_INTENTAR_RECORDAR, handlerInput);
    }
    if (list.length == 0) {
      return msgAndTell(NEVERA_VACIA, handlerInput);
    }

    // generar aviso de caducidad
    const strCaducadosOCasi = buscarCaducadosYProximosCaducados(list, timezone);

    let strTotal = '';
    if (list.length == 1) strTotal = 'Hay solo 1 producto en la nevera. ';
    else strTotal = `Hay ${list.length} productos en la nevera. `;

    return msgAndTell(strTotal + strCaducadosOCasi, handlerInput);
  },
};


const NuevoProductoHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && handlerInput.requestEnvelope.request.intent.name === 'NuevoProductoIntent';
  },
  async handle(handlerInput) {
    let nameProductSlot = handlerInput.requestEnvelope.request.intent.slots.nombreProducto.value;
    nameProductSlot = nameProductSlot.toLowerCase();

    const fCaducidadSlot = handlerInput.requestEnvelope.request.intent.slots.fechaCaducidad.value;
    const { userId } = handlerInput.requestEnvelope.context.System.user;

    const { requestEnvelope, serviceClientFactory, attributesManager } = handlerInput;
    const timezone = await obtenerTimezoneDeSessionOrApi(requestEnvelope, serviceClientFactory,
      attributesManager);

    const list = await obtenerListaDeSessionOrDB(userId, NOMBRE_NEVERA_GENERICA, ATTR_NAME,
      attributesManager);
    if (list == null) {
      return msgAndStop(ERROR_AL_INTENTAR_RECORDAR, handlerInput);
    }

    for (let i = 0; i < list.length; i += 1) {
      if (list[i].name == nameProductSlot) {
        return handlerInput.responseBuilder
          .speak(`Ya hay ${nameProductSlot} en tu nevera. Por favor di otro nombre o di 'borra ${nameProductSlot}'.`)
          .reprompt(`Por favor di otro nombre o di 'borra ${nameProductSlot}'.`)
          .getResponse();
      }
    }


    // si no está repe...

    const hoyFechaUser = fechaHoyUserToStringYYYYMMDD(timezone);

    const prod = {
      name: nameProductSlot,
      fecha_metido: hoyFechaUser,
      fechaCaducidadCerrado: fCaducidadSlot,
      fechaCaducidadAbierto: null,
    };

    list.unshift(prod);

    // actualizar session
    const sessionAttributes = attributesManager.getSessionAttributes();
    sessionAttributes[ATTR_NAME] = list;
    attributesManager.setSessionAttributes(sessionAttributes);

    const itemAttributes = {};
    itemAttributes[ATTR_NAME] = list;

    // guardar en bbdd. OJO, es con "update"
    return myDb.updateItemWithPrimarySortKey(userId, NOMBRE_NEVERA_GENERICA, itemAttributes)
      .then(data => msgAndStop(`Guardado ${nameProductSlot}, que caduca ${fCaducidadSlot}. `, handlerInput))
      .catch((err) => {
        console.log(`Error guardando, vuelve a intentarlo. ${err}`);
        return msgAndStop('Error guardando. Vuelve a intentarlo. ', handlerInput);
      });
  },
};


const QuitarProductoHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && handlerInput.requestEnvelope.request.intent.name === 'QuitarProductoIntent';
  },
  async handle(handlerInput) {
    let nameProductSlot = handlerInput.requestEnvelope.request.intent.slots.nombreProducto.value;
    nameProductSlot = nameProductSlot.toLowerCase();
    const { userId } = handlerInput.requestEnvelope.context.System.user;

    const { attributesManager } = handlerInput;

    const list = await obtenerListaDeSessionOrDB(userId, NOMBRE_NEVERA_GENERICA, ATTR_NAME,
      attributesManager);
    if (list == null) {
      return msgAndStop(ERROR_AL_INTENTAR_RECORDAR, handlerInput);
    }

    let encontradoQ = false;
    for (let i = 0; i < list.length; i += 1) {
      if (list[i].name == nameProductSlot) {
        encontradoQ = true;
        list.splice(i, 1); // elimina item
        break;
      }
    }

    if (encontradoQ == false) {
      return handlerInput.responseBuilder
        .speak(`No he encontrado ${nameProductSlot} en tu nevera. Di 'borrar' y el nombre del producto que quieras borrar.`)
        .reprompt("Di 'borrar' y el nombre del producto que quieras borrar.")
        .getResponse();
    }

    // actualizar session
    const sessionAttributes = attributesManager.getSessionAttributes();
    sessionAttributes[ATTR_NAME] = list;
    attributesManager.setSessionAttributes(sessionAttributes);

    const itemAttributes = {};
    itemAttributes[ATTR_NAME] = list;

    // guardar en bbdd. OJO! es con update.
    return myDb.updateItemWithPrimarySortKey(userId, NOMBRE_NEVERA_GENERICA, itemAttributes)
      .then(data => msgAndStop(`Eliminado ${nameProductSlot}. `, handlerInput))
      .catch((err) => {
        console.log(`Error eliminando. ${err}`);
        return msgAndStop(ERROR_AL_BORRAR_PRODUCTO, handlerInput);
      });
  },
};

const PASADO = -1;
const PRESENTE = 0;
const FUTURO = 1;

function fechaStringToVoiceString(strFecha, timezone) {
  const fTime = fechaStringUtcToMilliseconds(strFecha);

  const hoyTime = fechaStringUtcToMilliseconds(fechaHoyUserToStringYYYYMMDD(timezone));

  if (fTime == hoyTime) return { string: 'hoy', compare: PRESENTE };
  if (fTime == hoyTime - MILISEGSDIARIOS) return { string: 'ayer', compare: PASADO };
  if (fTime == hoyTime - 2 * MILISEGSDIARIOS) return { string: 'hace 2 días', compare: PASADO };
  if (fTime == hoyTime + MILISEGSDIARIOS) return { string: 'mañana', compare: FUTURO };
  if (fTime == hoyTime + 2 * MILISEGSDIARIOS) return { string: 'pasado mañana', compare: FUTURO };
  if (fTime > hoyTime) return { string: strFecha, compare: FUTURO };
  return { string: strFecha, compare: PASADO };
}

function conjugarVerbo(compare, pasado, presente, futuro) {
  if (compare == PRESENTE) return presente;
  if (compare == FUTURO) return futuro;
  return pasado;
}

const InfoProductoHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && handlerInput.requestEnvelope.request.intent.name === 'InfoProductoIntent';
  },
  async handle(handlerInput) {
    let nameProductSlot = handlerInput.requestEnvelope.request.intent.slots.nombreProducto.value;
    nameProductSlot = nameProductSlot.toLowerCase();
    const { userId } = handlerInput.requestEnvelope.context.System.user;

    const { requestEnvelope, serviceClientFactory, attributesManager } = handlerInput;

    const list = await obtenerListaDeSessionOrDB(userId, NOMBRE_NEVERA_GENERICA, ATTR_NAME,
      attributesManager);
    if (list == null) {
      return msgAndStop(ERROR_AL_INTENTAR_RECORDAR, handlerInput);
    }

    const timezone = await obtenerTimezoneDeSessionOrApi(requestEnvelope,
      serviceClientFactory,
      attributesManager);
    let encontradoQ = false;
    for (let i = 0; i < list.length; i += 1) {
      if (list[i].name == nameProductSlot) {
        encontradoQ = true;
        const cuandoAbierto = fechaStringToVoiceString(list[i].fecha_abierto, timezone);
        const cuandoMetido = fechaStringToVoiceString(list[i].fecha_metido, timezone);
        const cuandoCaducidadCerrado = fechaStringToVoiceString(list[i].fechaCaducidadCerrado, timezone);
        let str = `${list[i].name} `;
        str += `${conjugarVerbo(cuandoMetido.compare, 'se metió', 'se ha metido', null)} `;
        str += `${cuandoMetido.string}, `;

        if (list[i].fecha_abierto == null) {
          str += 'está cerrado y ';
          str
            += `${conjugarVerbo(cuandoCaducidadCerrado.compare, 'caducó', 'caduca', 'caducará')} `;
          str += `${cuandoCaducidadCerrado.string}. `;
        } else {
          const cuandoCaducidadAbierto = fechaStringToVoiceString(list[i].fechaCaducidadAbierto, timezone);
          str += `${conjugarVerbo(cuandoAbierto.compare, 'se abrió', 'se ha abierto', null)} `;
          str += `${cuandoAbierto.string} y `;
          str
            += `${conjugarVerbo(cuandoCaducidadAbierto.compare, 'caducó', 'caduca', 'caducará')} `;
          str += `${cuandoCaducidadAbierto.string}. `;
        }

        return msgAndTell(str, handlerInput);
      }
    }

    if (encontradoQ == false) {
      const str = `Producto ${nameProductSlot} no encontrado. Di 'info' y el nombre del producto.`;
      return msgAndTell(str, handlerInput);
    }
  },
};


const AbrirProductoHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && handlerInput.requestEnvelope.request.intent.name === 'AbrirProductoIntent';
  },
  async handle(handlerInput) {
    let nameProductSlot = handlerInput.requestEnvelope.request.intent.slots.nombreProducto.value;
    nameProductSlot = nameProductSlot.toLowerCase();

    const fCaducidadAbiertoSlot = handlerInput.requestEnvelope.request.intent.slots.fechaCaducidadAbierto.value;
    const { userId } = handlerInput.requestEnvelope.context.System.user;

    const { requestEnvelope, serviceClientFactory, attributesManager } = handlerInput;
    const timezone = await obtenerTimezoneDeSessionOrApi(requestEnvelope, serviceClientFactory,
      attributesManager);

    const list = await obtenerListaDeSessionOrDB(userId, NOMBRE_NEVERA_GENERICA, ATTR_NAME,
      attributesManager);
    if (list == null) {
      return msgAndStop(ERROR_AL_INTENTAR_RECORDAR, handlerInput);
    }

    let encontradoQ = false;
    let i = 0;
    for (i = 0; i < list.length; i += 1) {
      if (list[i].name == nameProductSlot) {
        encontradoQ = true;
        break;
      }
    }

    if (encontradoQ == false) {
      return msgAndTell(`No he encontrado ${nameProductSlot} en tu nevera. `, handlerInput);
    }

    // comprobar que fecha abierto <= hoy && fecha abierto <= fechaCaducidadCerrado
    const strFechaHoyUsuario = fechaHoyUserToStringYYYYMMDD(timezone);
    const timeHoyUser = fechaStringUtcToMilliseconds(strFechaHoyUsuario);
    const timeCaducidadAbierto = fechaStringUtcToMilliseconds(fCaducidadAbiertoSlot);
    const timeCaducidadCerrado = fechaStringUtcToMilliseconds(list[i].fechaCaducidadCerrado);

    if (timeCaducidadAbierto < timeHoyUser) {
      return msgAndTell('Ojo, me has dicho una fecha de caducidad ya pasada. No puedo guardarlo. ',
        handlerInput);
    }
    if (timeCaducidadAbierto > timeCaducidadCerrado) {
      return msgAndTell(`Ojo, me has dicho una fecha de caducidad posterior a la fecha de caducidad inicial que era ${list[i].fechaCaducidadCerrado}. Eso no se puede. `, handlerInput);
    }

    // actualizar list
    list[i].fecha_abierto = strFechaHoyUsuario;
    list[i].fechaCaducidadAbierto = fCaducidadAbiertoSlot;

    // actualizar session
    const sessionAttributes = attributesManager.getSessionAttributes();
    sessionAttributes[ATTR_NAME] = list;
    attributesManager.setSessionAttributes(sessionAttributes);

    const itemAttributes = {};
    itemAttributes[ATTR_NAME] = list;

    // guardar en bbdd. OJO! es con update.
    return myDb.updateItemWithPrimarySortKey(userId, NOMBRE_NEVERA_GENERICA, itemAttributes)
      .then(data => msgAndStop(`Abierto ${nameProductSlot}, ahora caduca ${fCaducidadAbiertoSlot}. `,
        handlerInput))
      .catch((err) => {
        console.log(`Error abriendo producto. ${err}`);
        return msgAndStop(ERROR_AL_ABRIR_PRODUCTO, handlerInput);
      });
  },
};


const ListadoHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && handlerInput.requestEnvelope.request.intent.name === 'ListadoIntent';
  },
  async handle(handlerInput) {
    const { userId } = handlerInput.requestEnvelope.context.System.user;

    const { attributesManager } = handlerInput;

    const list = await obtenerListaDeSessionOrDB(userId, NOMBRE_NEVERA_GENERICA, ATTR_NAME,
      attributesManager);
    if (list == null) {
      return msgAndStop(ERROR_AL_INTENTAR_RECORDAR, handlerInput);
    }
    if (list.length == 0) {
      return msgAndTell(NEVERA_VACIA, handlerInput);
    }

    let speechText = 'En la nevera hay: ';
    speechText += listToVoiceString(list, 'name');
    speechText += '. ';

    return msgAndTell(speechText, handlerInput);
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
    return msgAndStop('', handlerInput);
  },
};


const SessionEndedRequestHandler = {
  canHandle(handlerInput) {
    console.log('Inside SessionEndedRequestHandler');
    return handlerInput.requestEnvelope.request.type === 'SessionEndedRequest';
  },
  handle(handlerInput) {
    let ret = '';
    if (handlerInput.requestEnvelope.request.reason == 'ERROR') {
      ret = 'La skill se cerró por un error. Lo siento, vuelve a entrar.';
    } else if (handlerInput.requestEnvelope.request.reason == 'EXCEEDED_MAX_REPROMPTS') {
      ret = 'La skill se cerró por falta de respuesta correcta del usuario, vuelve a entrar.';
    } else {
      ret = 'Se cerró la sesión. Vuelve a entrar.';
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
    SessionEndedRequestHandler,
  )
  .addErrorHandlers(ErrorHandler)
  .withApiClient(new Alexa.DefaultApiClient()) // ServiceClientFactory are only available when
  .lambda(); // you configure skill instance with an ApiClient.
// https://ask-sdk-for-nodejs.readthedocs.io/en/
// /latest/Calling-Alexa-Service-APIs.html
// #serviceclientfactory
