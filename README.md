# Bombarda Arena (multiplayer online)

Jogo de bombas para navegador, de 2 a 10 jogadores online, com bots para completar a sala. O mapa cresce conforme o número de participantes (de 15×13, até 4 jogadores, a 27×19, com 10).
Cada jogador entra pelo link, cria ou entra numa sala com um código de 4 letras e joga pelo próprio navegador (computador ou celular).

## Como funciona

- `server.js`: servidor Node.js (só depende da biblioteca `ws`). Entrega a página e mantém as salas.
- `game.js`: toda a lógica da partida (mapa, movimento, bombas, bots). Roda no servidor, então ninguém consegue trapacear.
- `public/index.html`: o jogo no navegador. Envia as teclas e desenha o que o servidor manda.

## Testar no seu computador

Precisa do [Node.js](https://nodejs.org) 18 ou mais novo.

```
npm install
npm start
```

Abra http://localhost:3000. Para testar com amigos na mesma rede Wi-Fi, use o endereço IP do seu computador, por exemplo `http://192.168.0.10:3000`.

## Publicar de graça no Render

1. Crie uma conta gratuita em [github.com](https://github.com) e um repositório novo (pode ser público ou privado).
2. Envie estes arquivos para o repositório. Pelo site do GitHub dá para arrastar os arquivos (botão **Add file > Upload files**). Mantenha a pasta `public`.
3. Crie uma conta gratuita em [render.com](https://render.com) e entre com o GitHub.
4. Clique em **New > Web Service** e escolha o repositório.
5. Confira estes campos:
   - Runtime: **Node**
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Instance Type: **Free**
6. Clique em **Create Web Service**. Em alguns minutos aparece o endereço, algo como `https://bombarda-arena.onrender.com`.

(Se preferir, o arquivo `render.yaml` já traz essa configuração: use **New > Blueprint**.)

Para jogar: uma pessoa abre o endereço, digita o nome e clica em **Criar sala**. Depois clica em **Copiar convite** e manda o link para os amigos, que entram direto na sala.

## Limites do plano gratuito do Render

Conferidos na [documentação do Render](https://render.com/docs/free) em outubro de 2026. Podem mudar, então vale rever:

- O serviço **dorme após 15 minutos sem tráfego**. Durante a partida ele não dorme, porque as mensagens do jogo contam como tráfego.
- Quando está dormindo, o **primeiro acesso demora cerca de 1 minuto** para acordar. O jogo mostra um aviso enquanto isso. Dica: abra o endereço uns minutos antes de chamar o pessoal.
- São **750 horas gratuitas por mês** por conta. Como o serviço dorme sozinho, isso costuma sobrar.
- As salas ficam na memória. Se o serviço reiniciar ou dormir, as salas somem. É só criar outra.

## Controles

- **Computador:** setas ou WASD para andar; Espaço ou Enter para soltar a bomba.
- **Celular:** controle direcional e botão de bomba na tela.

## Regras

- A bomba explode em cruz depois de cerca de 2,5 segundos e acende outras bombas no caminho.
- Caixas explodem e podem soltar power-ups: mais bombas, mais alcance, mais velocidade.
- Quem for atingido sai da rodada. O último de pé leva o ponto. Se passar de 3 minutos, a rodada empata.
- Se alguém desconectar no meio da partida, um bot assume o lugar.
