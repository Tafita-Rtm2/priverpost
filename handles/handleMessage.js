const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { sendMessage } = require('./sendMessage');

const commands = new Map();
const userStates = new Map(); // Suivi des états des utilisateurs

// Charger les commandes
const commandFiles = fs.readdirSync(path.join(__dirname, '../commands')).filter(file => file.endsWith('.js'));
for (const file of commandFiles) {
  const command = require(`../commands/${file}`);
  commands.set(command.name, command);
}

// Fonction principale pour gérer les messages entrants
async function handleMessage(event, pageAccessToken) {
  const senderId = event.sender.id;

  if (event.message.attachments && event.message.attachments[0].type === 'image') {
    const imageUrl = event.message.attachments[0].payload.url;
    await handleImage(senderId, imageUrl, pageAccessToken, sendMessage);
  } else if (event.message.text) {
    const messageText = event.message.text.trim();
    await handleText(senderId, messageText, pageAccessToken, sendMessage);
  }
}

// Fonction pour gérer les images
async function handleImage(senderId, imageUrl, pageAccessToken, sendMessage) {
  try {
    await sendMessage(senderId, { text: '' }, pageAccessToken);

    const imageAnalysis = await analyzeImageWithGemini(imageUrl);

    if (imageAnalysis) {
      await sendMessage(senderId, { text: 'Que voulez-vous que je fasse avec cette image ?' }, pageAccessToken);
      userStates.set(senderId, { mode: 'image_action', imageAnalysis }); // Enregistrer l'analyse et passer en mode action
    } else {
      await sendMessage(senderId, { text: "Je n'ai pas pu obtenir de réponse concernant cette image." }, pageAccessToken);
    }
  } catch (error) {
    console.error('Erreur lors de l\'analyse de l\'image :', error);
    await sendMessage(senderId, { text: 'Erreur lors de l\'analyse de l\'image.' }, pageAccessToken);
  }
}

// Fonction pour gérer les textes
async function handleText(senderId, text, pageAccessToken, sendMessage) {
  const args = text.split(' ');
  const commandName = args.shift().toLowerCase();
  const command = commands.get(commandName);
  const userState = userStates.get(senderId);

  if (text.toLowerCase().startsWith("gemini générer")) {
    const prompt = text.replace("gemini générer", "").trim();
    await handleGeminiImageCommand(senderId, prompt, pageAccessToken);
  } else if (userState && userState.mode === 'image_action') {
    // L'utilisateur a donné une commande sur l'image
    await handleImageAction(senderId, text, userState.imageAnalysis, pageAccessToken, sendMessage);
  } else if (command) {
    // Exécuter la commande si elle est trouvée
    try {
      await command.execute(senderId, args, pageAccessToken, sendMessage);
    } catch (error) {
      console.error(`Erreur lors de l'exécution de la commande ${commandName}:`, error);
      await sendMessage(senderId, { text: `Erreur lors de l'exécution de la commande ${commandName}.` }, pageAccessToken);
    }
  } else {
    // Si aucune commande trouvée et pas en mode image
    const gpt4oCommand = commands.get('gpt4o');
    if (gpt4oCommand) {
      try {
        await gpt4oCommand.execute(senderId, [text], pageAccessToken, sendMessage);
      } catch (error) {
        console.error('Erreur avec GPT-4o :', error);
        await sendMessage(senderId, { text: 'Erreur lors de l\'utilisation de GPT-4o.' }, pageAccessToken);
      }
    } else {
      await sendMessage(senderId, { text: "Je n'ai pas pu traiter votre demande." }, pageAccessToken);
    }
  }
}

// Fonction pour gérer l'action demandée sur l'analyse de l'image
async function handleImageAction(senderId, userQuery, imageAnalysis, pageAccessToken, sendMessage) {
  try {
    // Utiliser GPT-4o pour traiter la description de l'image et la demande de l'utilisateur
    const gpt4oCommand = commands.get('gpt4o');
    if (gpt4oCommand) {
      const fullQuery = `Voici l'analyse de l'image : "${imageAnalysis}". L'utilisateur souhaite : "${userQuery}".`;
      await gpt4oCommand.execute(senderId, [fullQuery], pageAccessToken, sendMessage);
    } else {
      await sendMessage(senderId, { text: "Erreur : GPT-4o n'est pas disponible." }, pageAccessToken);
    }

    // Après avoir traité l'action, revenir au mode général
    userStates.set(senderId, { mode: 'general_discussion' });
  } catch (error) {
    console.error('Erreur lors de l\'action sur l\'image :', error);
    await sendMessage(senderId, { text: 'Erreur lors du traitement de votre demande.' }, pageAccessToken);
  }
}

// Fonction pour appeler l'API Gemini pour générer une image
async function generateImage(prompt) {
  const geminiImageApiEndpoint = 'https://sdxl-kshitiz.onrender.com/gen';

  try {
    const { data } = await axios.get(`${geminiImageApiEndpoint}?prompt=${encodeURIComponent(prompt)}&style=3`);
    return data.url;
  } catch (error) {
    console.error('Erreur lors de la génération de l’image avec Gemini:', error);
    throw new Error('Erreur lors de la génération de l’image');
  }
}

// Fonction pour gérer la commande de génération d'image Gemini
async function handleGeminiImageCommand(senderId, prompt, pageAccessToken) {
  try {
    // Indique que l'image est en cours de génération
    await sendMessage(senderId, { text: '💬 *Gemini est en train de générer une image* ⏳...\n\n─────★─────' }, pageAccessToken);

    // Générer l'URL de l'image via l'API Gemini
    const imageUrl = await generateImage(prompt);

    // Envoyer directement l'image en utilisant l'URL sans la télécharger localement
    await sendMessage(senderId, {
      attachment: {
        type: 'image',
        payload: {
          url: imageUrl,
          is_reusable: true
        }
      }
    }, pageAccessToken);
  } catch (error) {
    console.error('Erreur lors de la génération de l’image :', error);
    await sendMessage(senderId, { text: 'Désolé, une erreur est survenue lors de la génération de l’image.' }, pageAccessToken);
  }
}

// Fonction pour appeler l'API Gemini pour analyser une image
async function analyzeImageWithGemini(imageUrl) {
  const geminiApiEndpoint = 'https://sandipbaruwal.onrender.com/gemini2'; 

  try {
    const response = await axios.get(`${geminiApiEndpoint}?url=${encodeURIComponent(imageUrl)}`);
    return response.data && response.data.answer ? response.data.answer : '';
  } catch (error) {
    console.error('Erreur avec Gemini :', error);
    throw new Error('Erreur lors de l\'analyse avec Gemini');
  }
}

module.exports = { handleMessage };
