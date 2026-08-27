# Botões para o CRM do GHL

Projeto comunitário que adiciona um controle **Open / Close / Closed** ao cabeçalho de Conversations do CRM do GHL. Ele ajuda a assumir um atendimento e controlar seu estado usando o proprietário e as tags nativas do CRM.

> Projeto independente, sem vínculo oficial com o GHL.

## Como funciona

O botão representa o estado confirmado pelas tags do contato:

- Sem `open` e sem `closed`: **Open**.
- Com `open` e sem `closed`: **Close**.
- Com `closed`: **Closed**, sem nova ação automática.

Ao clicar em **Open**, o script tenta, de forma independente:

1. Atribuir a conversa ao usuário conectado.
2. Adicionar a tag `open`.

Se uma das ações falhar, a outra ainda pode ser concluída. O botão mostra um aviso e permite uma nova tentativa quando necessário.

Ao clicar em **Close**, o script adiciona a tag `closed` e preserva a tag `open`, as demais tags e o proprietário atual. Para segurança, o fechamento só é executado quando a tag `open` já está confirmada.

O script reconhece tanto a janela atual de seleção de tags quanto a interface anterior em formato de menu. Ele também verifica a conversa ativa durante cada operação para reduzir o risco de alterar o contato errado em uma navegação interna do CRM.

## Requisitos

- Crie, em cada subconta, as tags `open` e `closed`, exatamente em letras minúsculas.
- Garanta que o usuário tenha permissão para alterar o proprietário e as tags.
- Faça a primeira instalação e cada atualização em um contato de teste autorizado.

## Instalação

No campo de código personalizado da conta, adicione esta única linha:

```html
<script src="https://cdn.jsdelivr.net/gh/hubglobalsolutionscom-rgb/botoes-crm-ghl@main/ghl-conversation-control.js" async crossorigin="anonymous" referrerpolicy="no-referrer"></script>
```

Use a linha somente uma vez. A referência `@main` acompanha as atualizações publicadas neste repositório após a renovação do cache da CDN.

Para controlar totalmente as atualizações, faça um fork e troque `hubglobalsolutionscom-rgb/botoes-crm-ghl` por `SEU-USUARIO/SEU-REPOSITORIO`. Para fixar uma versão específica, substitua `@main` por uma tag de versão, como `@v1.3.0`.

Se o campo aceitar somente JavaScript, use:

```javascript
(()=>{const s=document.createElement("script");s.src="https://cdn.jsdelivr.net/gh/hubglobalsolutionscom-rgb/botoes-crm-ghl@main/ghl-conversation-control.js";s.async=true;s.crossOrigin="anonymous";s.referrerPolicy="no-referrer";document.head.appendChild(s)})();
```

## Segurança e privacidade

- O código publicado não contém tokens, senhas, cookies, chaves de API, IDs de subcontas ou dados de contatos.
- Não há telemetria, servidor próprio ou chamadas de rede no script. O navegador apenas baixa o arquivo da CDN, e o próprio CRM persiste as ações.
- As alterações são feitas pela interface já aberta no navegador; o próprio CRM aplica e registra as ações usando a sessão e as permissões do usuário conectado.
- Código personalizado executa com os privilégios da sessão aberta. Ao usar `@main`, você confia também nas atualizações futuras deste repositório; use um fork ou uma versão fixada se precisar de controle próprio.
- Nunca coloque credenciais ou identificadores privados no código. Não publique capturas com dados reais em Issues ou Pull Requests.
- Revise e teste cada atualização antes de utilizá-la em produção. A interface do CRM não é uma API pública estável e pode mudar.

Leia [SECURITY.md](SECURITY.md) antes de relatar uma possível vulnerabilidade.

## Contribuindo

Melhorias são bem-vindas. Consulte [CONTRIBUTING.md](CONTRIBUTING.md), execute `npm test` e abra um Pull Request sem dados reais de contas ou contatos.

## Apoie o projeto

Quem quiser ajudar na manutenção do projeto pode fazer uma contribuição simbólica de **R$ 18**.

- **Chave Pix:** em breve
- **Pagamento em dólar:** link em breve

A contribuição é opcional e não altera o acesso ao código.

## Licença

Distribuído sob a licença MIT. Consulte [LICENSE](LICENSE).
