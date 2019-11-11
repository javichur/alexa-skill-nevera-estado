module.exports = {
  /**
   * Returns a response with APL (if compatible) or just voice response
   * @param {Object} handlerInput
   * @param {string} title
   * @param {string} text
   * @param {string} hint
   * @param {string} speechText
   * @param {bool} isStop indica si hay que cerrar sesión después (true) o no (false)
   */
  getAplTextAndHintOrVoice(handlerInput, title, text, hint, speechText, isStop) {
    const ret = handlerInput.responseBuilder
      .speak(speechText);

    if (handlerInput.requestEnvelope.context.System.device.supportedInterfaces['Alexa.Presentation.APL']) {
      /* si hay soporte APL... */
      const docu = require('./documentTextAndHint.json'); // eslint-disable-line global-require
      const d = require('./myDataSourceTextAndHint'); // eslint-disable-line global-require

      d.data.title = title;
      d.data.text = text;
      d.data.hintText = hint;

      ret.addDirective({
        type: 'Alexa.Presentation.APL.RenderDocument',
        version: '1.0',
        document: docu,
        datasources: d,
      });
    } else {
      ret.withSimpleCard(title, speechText)
        .getResponse();
    }

    if (!isStop) {
      ret.reprompt(speechText + hint);
    } else {
      ret.withShouldEndSession(true);
    }

    return ret.getResponse();
  },
};
