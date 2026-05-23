# Casa RP Thermo

App multi-equipamentos da Casa RP Resistências — monitoramento térmico, botão WhatsApp inteligente e pronto para integração com ESP32.

## O que tem nesta versão

- **18 equipamentos** com cards 3D: sauna seca, sauna a vapor, piscina, boiler, buffet, banho-maria, pista quente, forno industrial, fritadeira, lava-louças, chuveiro industrial, estufa de secagem, caldeira a vapor, aquecedor de ar, pasteurizador, aquecedor de passagem, forno de confeitaria e resistência de extrusora.
- **Botão WhatsApp em cada card** com mensagem pré-preenchida (nome do equipamento, temperatura atual, tipo de resistência, ligação).
- **Botão de Assistência destacado** no dashboard — mensagem inteligente com situação atual detectada.
- **Sistema de monitoramento real**: aceita dados de ESP32 via `POST /api/sensor`. Enquanto não há hardware, exibe dados simulados com badge "SIMULADO". Com ESP32 conectado, mostra "AO VIVO" e dispara alertas automáticos.
- **Alertas automáticos**: quando a temperatura desvia mais que o threshold do equipamento, aparece badge "ALERTA" vermelho no dashboard.
- Backend Node.js zero dependências — sobe direto no Railway.

## Rodar localmente

```bash
npm start
```

Abre: `http://localhost:3000`

## Publicar no Railway

1. Crie um projeto no [Railway](https://railway.app)
2. Conecte o repositório `casa-rp-app` do GitHub
3. O Railway detecta o `package.json` e usa `npm start`
4. Variável de ambiente opcional: `SENSOR_TOKEN=meu-token` para autenticar o ESP32

## Integração com ESP32 (dados reais)

Quando o ESP32 estiver instalado no equipamento do cliente, ele deve enviar:

```http
POST /api/sensor
Content-Type: application/json
X-Sensor-Token: meu-token

{
  "id": "sauna-seca",
  "temp": 78.5,
  "humidity": 12,
  "voltage": 220,
  "clientName": "Academia Silva"
}
```

**IDs válidos:** `sauna-seca`, `sauna-vapor`, `piscina`, `boiler`, `buffet`, `banho-maria`, `pista-quente`, `forno`, `fritadeira`, `lava-loucas`, `chuveiro`, `estufa`, `caldeira`, `aquecedor-ar`, `pasteurizador`, `passagem`, `forno-confeitaria`, `extrusora`

O app atualiza automaticamente a cada 30 segundos. Dados com mais de 5 minutos voltam para simulação.

## Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/healthz` | Status do servidor |
| GET | `/api/config` | Dados do negócio + catálogo |
| GET | `/api/equipment` | Lista de equipamentos |
| GET | `/api/equipment/:id/telemetry` | Telemetria (real ou simulada) |
| POST | `/api/sensor` | Ingestão de dados do ESP32 |
| GET | `/api/alerts` | Alertas ativos (só dados reais) |
| POST | `/api/equipment/:id/command` | Comando (modo demonstração) |

## Logo oficial

Coloque o arquivo da marca em: `public/assets/logo-casa-rp.png`
