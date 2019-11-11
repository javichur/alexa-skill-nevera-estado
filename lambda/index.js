/* eslint-disable  func-names */
/* eslint-disable  no-console */
/* eslint-disable global-require */

/* Skill "Nevera estado".
 * Creada por Javier Campos (https://javiercampos.es).
 * 21/2/2019
*/

// NOTA: Las funciones Lambda funcionan con timezone UTC.

/* 1. Cargamos las dependencias. */
const Alexa = require('ask-sdk-core');
const Dynamola = require('dynamola');
const moment = require('moment-timezone');

const Settings = require('./settings.js');

// editar siguientes líneas según tu tabla DynamoDB
const myDb = new Dynamola(Settings.TABLE_NAME_DYNAMODB, Settings.PARTITION_KEY_NAME,
  Settings.SORT_KEY_NAME);
const NOMBRE_NEVERA_GENERICA = 'casa';
const ATTR_NAME = 'productos';

/* 2. Cadenas e idioma */
const LOC = {
  t: null, // cadenas de texto localizadas. Se inicializa en myLocalizationInterceptor()
  langSkill: null, // current language ('es-ES', 'en-US', 'en', etc...)
};

const skillBuilder = Alexa.SkillBuilders.custom();

/* 2. Constantes */
const MILISEGSDIARIOS = 86400000;

function msgAndTell(msg, handlerInput) {
  return handlerInput.responseBuilder
    .speak(msg + LOC.t.DIME_POR_EJEMPLO)
    .withSimpleCard(LOC.t.SKILL_NAME, msg)
    .reprompt(msg)
    .getResponse();
}

function msgAndStop(msg, handlerInput) {
  return handlerInput.responseBuilder
    .speak(msg + LOC.t.STOP_MESSAGE)
    .withSimpleCard(LOC.t.SKILL_NAME, msg)
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
    else if (i === list.length - 2) ret += ` ${LOC.t.Y} `;
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
  if (list.length === 1) {
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
  if (listCaducanHoyCerradoOAbierto.length === 0
    && listCaducanMananaCerradoOAbierto.length === 0
    && listCaducanPasadoMananaCerradoOAbierto.length === 0) {
    strResumen = LOC.t.NINGUN_PRODUCTO_CADUCA_PROXIMOS_2_DIAS;
  } else {
    strResumen = resumenDeUnTipoDeProducto(listCaducanHoyCerradoOAbierto,
      LOC.t.CADUCA_HOY, LOC.t.CADUCAN_HOY);
    strResumen += resumenDeUnTipoDeProducto(listCaducanMananaCerradoOAbierto,
      LOC.t.CADUCA_MANANA, LOC.t.CADUCAN_MANANA);
    strResumen += resumenDeUnTipoDeProducto(listCaducanPasadoMananaCerradoOAbierto,
      LOC.t.CADUCA_PASADO_MANANA, LOC.t.CADUCAN_PASADO_MANANA);
  }

  strResumen += resumenDeUnTipoDeProducto(listCaducadoCerradoOAbierto,
    LOC.t.YA_HA_CADUCADO, LOC.t.YA_HAN_CADUCADO);

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
  moment.locale(LOC.langSkill); // para que diga meses en idioma correspondiente.

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
    } else if (fCaducidadAbierto !== null && fCaducidadAbierto.getTime() === hoyTime) {
      // abierto y caduca hoy por abierto
      listCaducanHoyCerradoOAbierto.unshift(name);
    } else if (fCaducidadAbierto != null
      && fCaducidadAbierto.getTime() === hoyTime + MILISEGSDIARIOS) {
      // abierto y caduca MAÑANA por abierto
      listCaducanMananaCerradoOAbierto.unshift(name);
    } else if (fCaducidadAbierto != null
      && fCaducidadAbierto.getTime() === hoyTime + 2 * MILISEGSDIARIOS) {
      // abierto y caduca PASADO MAÑANA por abierto
      listCaducanPasadoMananaCerradoOAbierto.unshift(name);
    } else if (fCaducidadCerrado.getTime() < hoyTime) { // caducado según fecha envase
      listCaducadoCerradoOAbierto.unshift(name);
    } else if (fCaducidadCerrado.getTime() === hoyTime) { // caduca HOY según fecha envase
      listCaducanHoyCerradoOAbierto.unshift(name);
    } else if (fCaducidadCerrado.getTime() === hoyTime + MILISEGSDIARIOS) {
      // caduca MAÑANA según fecha envase
      listCaducanMananaCerradoOAbierto.unshift(name);
    } else if (fCaducidadCerrado.getTime() === hoyTime + 2 * MILISEGSDIARIOS) {
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
    if (list === null) {
      return msgAndStop(LOC.t.ERROR_AL_INTENTAR_RECORDAR, handlerInput);
    }
    if (list.length === 0) {
      return msgAndTell(LOC.t.NEVERA_VACIA, handlerInput);
    }

    // generar aviso de caducidad
    const strCaducadosOCasi = buscarCaducadosYProximosCaducados(list, timezone);

    let strTotal = '';
    if (list.length === 1) strTotal = LOC.t.SOLO_HAY_1_PRODUCTO_EN_NEVERA;
    else strTotal = LOC.t.HAY_X_PRODUCTOS_EN_NEVERA.replace('{0}', list.length);

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
    if (list === null) {
      return msgAndStop(LOC.t.ERROR_AL_INTENTAR_RECORDAR, handlerInput);
    }

    for (let i = 0; i < list.length; i += 1) {
      if (list[i].name === nameProductSlot) {
        const diOtro = LOC.t.DI_OTRO_O_BORRA.replace('{0}', nameProductSlot);
        return handlerInput.responseBuilder
          .speak(LOC.t.YA_HAY_X.replace('{0}', nameProductSlot) + diOtro)
          .reprompt(diOtro)
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
      .then(() => {
        let msg = LOC.t.GUARDADO_X_QUE_CADUCA_EN_Y.replace('{0}', nameProductSlot);
        msg = msg.replace('{1}', fCaducidadSlot);
        return msgAndStop(msg, handlerInput);
      })
      .catch((err) => {
        console.log(`${LOC.t.ERROR_GUARDANDO}${err}`);
        return msgAndStop(LOC.t.ERROR_GUARDANDO, handlerInput);
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
    if (list === null) {
      return msgAndStop(LOC.t.ERROR_AL_INTENTAR_RECORDAR, handlerInput);
    }

    let encontradoQ = false;
    for (let i = 0; i < list.length; i += 1) {
      if (list[i].name === nameProductSlot) {
        encontradoQ = true;
        list.splice(i, 1); // elimina item
        break;
      }
    }

    if (encontradoQ === false) {
      const msg = LOC.t.NO_HE_ENCONTRADO_X.replace('{0}', nameProductSlot) + LOC.t.DI_BORRAR_SEGUIDO_NOMBRE;
      return handlerInput.responseBuilder
        .speak(msg)
        .reprompt(LOC.t.DI_BORRAR_SEGUIDO_NOMBRE)
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
      .then(() => msgAndStop(LOC.t.ELIMINADO_X.replace('{0}', nameProductSlot), handlerInput))
      .catch((err) => {
        console.log(`Error eliminando. ${err}`);
        return msgAndStop(LOC.t.ERROR_AL_BORRAR_PRODUCTO, handlerInput);
      });
  },
};

const PASADO = -1;
const PRESENTE = 0;
const FUTURO = 1;

function fechaStringToVoiceString(strFecha, timezone) {
  const fTime = fechaStringUtcToMilliseconds(strFecha);

  const hoyTime = fechaStringUtcToMilliseconds(fechaHoyUserToStringYYYYMMDD(timezone));

  if (fTime === hoyTime) return { string: LOC.t.HOY, compare: PRESENTE };
  if (fTime === hoyTime - MILISEGSDIARIOS) return { string: LOC.t.AYER, compare: PASADO };
  if (fTime === hoyTime - 2 * MILISEGSDIARIOS) {
    return { string: LOC.t.HACE_2_DIAS, compare: PASADO };
  }
  if (fTime === hoyTime + MILISEGSDIARIOS) return { string: LOC.t.MAÑANA, compare: FUTURO };
  if (fTime === hoyTime + 2 * MILISEGSDIARIOS) {
    return { string: LOC.t.PASADO_MAÑANA, compare: FUTURO };
  }
  if (fTime > hoyTime) return { string: strFecha, compare: FUTURO };
  return { string: strFecha, compare: PASADO };
}

function conjugarVerbo(compare, pasado, presente, futuro) {
  if (compare === PRESENTE) return presente;
  if (compare === FUTURO) return futuro;
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
    if (list === null) {
      return msgAndStop(LOC.t.ERROR_AL_INTENTAR_RECORDAR, handlerInput);
    }

    const timezone = await obtenerTimezoneDeSessionOrApi(requestEnvelope,
      serviceClientFactory,
      attributesManager);

    let encontradoQ = false;
    for (let i = 0; i < list.length; i += 1) {
      if (list[i].name === nameProductSlot) {
        encontradoQ = true;
        const cuandoAbierto = fechaStringToVoiceString(list[i].fecha_abierto, timezone);
        const cuandoMetido = fechaStringToVoiceString(list[i].fecha_metido, timezone);
        const cuandoCaducidadCerrado = fechaStringToVoiceString(list[i].fechaCaducidadCerrado,
          timezone);

        console.log('cuandoCaducidadCerrado: ' + cuandoCaducidadCerrado);

        let str = `${list[i].name} `;
        str += `${conjugarVerbo(cuandoMetido.compare, LOC.t.SE_METIO, LOC.t.SE_HA_METIDO, null)} `;
        str += `${cuandoMetido.string}, `;

        if (list[i].fecha_abierto == null) {
          str += LOC.t.ESTA_CERRADO_Y;
          str += `${conjugarVerbo(cuandoCaducidadCerrado.compare, LOC.t.CADUCO, LOC.t.CADUCA,
            LOC.t.CADUCARA)} `;
          str += `${cuandoCaducidadCerrado.string}. `;
        } else {
          const cuandoCaducidadAbierto = fechaStringToVoiceString(list[i].fechaCaducidadAbierto,
            timezone);
          str += `${conjugarVerbo(cuandoAbierto.compare, LOC.t.SE_ABRIO, LOC.t.SE_HA_ABIERTO,
            null)} `;
          str += `${cuandoAbierto.string} ${LOC.t.Y} `;
          str += `${conjugarVerbo(cuandoCaducidadAbierto.compare, LOC.t.CADUCO, LOC.t.CADUCA,
            LOC.t.CADUCARA)} `;
          str += `${cuandoCaducidadAbierto.string}. `;
        }

        return msgAndTell(str, handlerInput);
      }
    }

    if (encontradoQ === false) {
      const str = LOC.t.NO_HE_ENCONTRADO_X.replace('{0}',
        nameProductSlot) + LOC.t.DI_INFO_SEGUIDO_NOMBRE;
      return msgAndTell(str, handlerInput);
    }

    return null; // caso imposible
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

    const fCaducidadAbiertoSlot = handlerInput.requestEnvelope.request.intent.slots
      .fechaCaducidadAbierto.value;

    const { userId } = handlerInput.requestEnvelope.context.System.user;
    const { requestEnvelope, serviceClientFactory, attributesManager } = handlerInput;

    const timezone = await obtenerTimezoneDeSessionOrApi(requestEnvelope, serviceClientFactory,
      attributesManager);

    const list = await obtenerListaDeSessionOrDB(userId, NOMBRE_NEVERA_GENERICA, ATTR_NAME,
      attributesManager);
    if (list === null) {
      return msgAndStop(LOC.t.ERROR_AL_INTENTAR_RECORDAR, handlerInput);
    }

    let encontradoQ = false;
    let i = 0;
    for (i = 0; i < list.length; i += 1) {
      if (list[i].name === nameProductSlot) {
        encontradoQ = true;
        break;
      }
    }

    if (encontradoQ === false) {
      return msgAndTell(LOC.t.NO_HE_ENCONTRADO_X.replace('{0}', nameProductSlot),
        handlerInput);
    }

    // comprobar que fecha abierto <= hoy && fecha abierto <= fechaCaducidadCerrado
    const strFechaHoyUsuario = fechaHoyUserToStringYYYYMMDD(timezone);
    const timeHoyUser = fechaStringUtcToMilliseconds(strFechaHoyUsuario);
    const timeCaducidadAbierto = fechaStringUtcToMilliseconds(fCaducidadAbiertoSlot);
    const timeCaducidadCerrado = fechaStringUtcToMilliseconds(list[i].fechaCaducidadCerrado);

    if (timeCaducidadAbierto < timeHoyUser) {
      return msgAndTell(LOC.t.OJO_FECHA_CADUCIDAD_PASADA,
        handlerInput);
    }
    if (timeCaducidadAbierto > timeCaducidadCerrado) {
      return msgAndTell(LOC.t.OJO_FECHA_CADUCIDAD_ABIERTO_POSTERIOR_A_CERRADO.replace('{0}', list[i].fechaCaducidadCerrado),
        handlerInput);
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
      .then(() => {
        let msg = LOC.t.ABIERTO_X_CADUCA_EN.replace('{0}', nameProductSlot);
        msg = msg.replace('{1}', fCaducidadAbiertoSlot);
        return msgAndStop(msg, handlerInput);
      })
      .catch((err) => {
        console.log(`Error abriendo producto. ${err}`);
        return msgAndStop(LOC.t.ERROR_AL_ABRIR_PRODUCTO, handlerInput);
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
      return msgAndStop(LOC.t.ERROR_AL_INTENTAR_RECORDAR, handlerInput);
    }
    if (list.length === 0) {
      return msgAndTell(LOC.t.NEVERA_VACIA, handlerInput);
    }

    let speechText = LOC.t.EN_LA_NEVERA_HAY;
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
    return msgAndTell(LOC.t.HELP_MESSAGE, handlerInput);
  },
};


const FallbackHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'IntentRequest'
      && handlerInput.requestEnvelope.request.intent.name === 'AMAZON.FallbackIntent';
  },
  handle(handlerInput) {
    return msgAndTell(LOC.t.NO_ENTIENDO_REPITE_POR_FAVOR, handlerInput);
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
    if (handlerInput.requestEnvelope.request.reason === 'ERROR') {
      ret = LOC.t.SESION_CERRADA_ERROR;
    } else if (handlerInput.requestEnvelope.request.reason === 'EXCEEDED_MAX_REPROMPTS') {
      ret = LOC.t.SESION_CERRADA_POR_NO_RESUESTA;
    } else {
      ret = LOC.t.SESION_CERRADA;
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

    return msgAndStop(LOC.t.ERROR_INESPERADO, handlerInput);
  },
};

// Initialize 't' and 'langSkill' with user language or default language.
const myLocalizationInterceptor = {
  process(handlerInput) {
    const langUser = handlerInput.requestEnvelope.request.locale;

    if (langUser) {
      try {
        LOC.t = require(`./strings/${langUser}.js`); // eslint-disable-line import/no-dynamic-require
        LOC.langSkill = langUser;
        return;
      } catch (e) {
        // console.log(`Error reading strings. langUser: ${langUser}`);
      }

      const lang = langUser.split('-')[0];
      try {
        LOC.t = require(`./strings/${lang}.js`); // eslint-disable-line import/no-dynamic-require
        LOC.langSkill = lang;
        return;
      } catch (e) {
        // console.log(`Error reading strings. lang: ${lang}`);
      }
    }

    // default lang
    LOC.langSkill = Settings.DEFAULT_LANGUAGE;
    LOC.t = require(`./strings/${LOC.langSkill}.js`); // eslint-disable-line import/no-dynamic-require
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
  .addRequestInterceptors(myLocalizationInterceptor)
  .addErrorHandlers(ErrorHandler)
  .withApiClient(new Alexa.DefaultApiClient()) // ServiceClientFactory are only available when
  .lambda(); // you configure skill instance with an ApiClient.
// https://ask-sdk-for-nodejs.readthedocs.io/en/
// /latest/Calling-Alexa-Service-APIs.html
// #serviceclientfactory
