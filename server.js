// server.js
const express = require("express");
const admin = require("firebase-admin");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// === Firebase Admin ===
const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// Tarifa da passagem (valor debitado)
const FARE = 4.8;

// ===================================================================
// ROTA QUE O ESP VAI CHAMAR
// POST /validar-passagem  { "tag": "UID_DO_CARTAO" }
// ===================================================================
app.post("/validar-passagem", async (req, res) => {
  try {
    const { tag } = req.body;

    if (!tag) {
      return res.status(400).json({ error: "Campo 'tag' é obrigatório" });
    }

    console.log("Tag recebida:", tag);

    // 1) Procurar usuário pela TAG
    const snap = await db
      .collection("users")
      .where("cardTag", "==", tag)
      .limit(1)
      .get();

    if (snap.empty) {
      console.log("Nenhum usuário encontrado para essa tag.");
      return res.status(200).json({
        autorizado: false,
        motivo: "TAG_DESCONHECIDA",
      });
    }

    const userDoc = snap.docs[0];
    const userId = userDoc.id;
    const userRef = db.collection("users").doc(userId);

    let respostaSaida = {
      autorizado: false,
      motivo: "ERRO_DESCONHECIDO",
    };

    // 2) Transação atômica para debitar saldo + registrar passagem
    await db.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);

      if (!userSnap.exists) {
        respostaSaida = {
          autorizado: false,
          motivo: "USUARIO_NAO_ENCONTRADO",
        };
        return;
      }

      const data = userSnap.data();
      const saldoAtual = Number(data.balance || 0);

      // Se não tiver saldo suficiente
      if (saldoAtual < FARE) {
        respostaSaida = {
          autorizado: false,
          motivo: "SALDO_INSUFICIENTE",
          saldoAtual,
        };
        return;
      }

      const novoSaldo = saldoAtual - FARE;

      // Monta o objeto da transação no MESMO formato que o app usa
      const agoraMs = Date.now(); // igual às recargas que já existem

      const novaTransacao = {
        id: agoraMs,
        type: "passagem",
        amount: -FARE,
        timestamp: agoraMs, // número em ms, não serverTimestamp
      };

      // Atualiza saldo e adiciona a transação no array "transactions" do usuário
      tx.update(userRef, {
        balance: novoSaldo,
        transactions: admin.firestore.FieldValue.arrayUnion(novaTransacao),
      });

      respostaSaida = {
        autorizado: true,
        novoSaldo,
      };
    });

    console.log("Resposta enviada para o ESP:", respostaSaida);
    return res.status(200).json(respostaSaida);
  } catch (err) {
    console.error("Erro em /validar-passagem:", err);
    return res.status(500).json({ error: "Erro interno no servidor" });
  }
});

// ===================================================================
// Sobe o servidor na porta 3000
// ===================================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API NFC rodando na porta ${PORT}`);
});
