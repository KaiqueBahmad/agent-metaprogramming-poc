import { openDatabase } from "../apps/api/src/database";
import { seed, demoPassword } from "../apps/api/src/seed";

const command = process.argv[2];
if (command !== "clear" && command !== "seed")
  throw new Error("Use clear ou seed.");
const db = openDatabase(undefined, { reset: command === "clear" });
try {
  if (command === "clear")
    console.log(
      "Banco limpo e estrutura multiempresa recriada. Todas as sessões foram invalidadas.",
    );
  else {
    console.log("Seed concluído:", seed(db));
    console.log(`Senha de demonstração: ${demoPassword}`);
    console.log(
      "Usuários: admin, ana, bruno, carla, diego e semvinculo @forma.example",
    );
  }
} finally {
  db.close();
}
