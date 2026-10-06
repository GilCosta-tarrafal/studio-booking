'use strict';
// ---------------------------------------------------------------------------
// Tradução do painel (português → inglês/francês).
//
// O painel é desenhado em português. Este ficheiro corre ANTES do common.js e
// põe de pé um window.I18N reativo (para as datas e os números seguirem a
// língua) e, quando a língua não é o português, traduz o DOM à medida que é
// desenhado, através de um MutationObserver — assim apanha todas as vistas,
// janelas e atualizações sem ser preciso tocar no código que as cria.
//
// O que não estiver na tabela TAB fica em português (nunca parte nada).
// ---------------------------------------------------------------------------
(function () {
  const D = window.DICIONARIO;
  const COD = ['pt', 'en', 'fr'];
  let lingua = 'pt';
  try { const s = localStorage.getItem('admin-lingua'); if (COD.includes(s)) lingua = s; } catch (_) { /* navegação privada */ }

  // Português → { en, fr }. As chaves são o texto EXATO que aparece no ecrã.
  const TAB = {
    // ---- Navegação e secções ----
    'Dashboard': { en: 'Dashboard', fr: 'Tableau de bord' },
    'Painel': { en: 'Panel', fr: 'Panneau' },
    'Calendário': { en: 'Calendar', fr: 'Calendrier' },
    'Marcações': { en: 'Bookings', fr: 'Réservations' },
    'Clientes': { en: 'Clients', fr: 'Clients' },
    'Relatórios': { en: 'Reports', fr: 'Rapports' },
    'Estúdios': { en: 'Studios', fr: 'Studios' },
    'Serviços': { en: 'Services', fr: 'Services' },
    'Integrações': { en: 'Integrations', fr: 'Intégrations' },
    'Música': { en: 'Music', fr: 'Musique' },
    'Projetos': { en: 'Projects', fr: 'Projets' },
    'Gestão de acesso': { en: 'Access management', fr: 'Gestion des accès' },
    'Definições': { en: 'Settings', fr: 'Paramètres' },
    'Secções do painel': { en: 'Panel sections', fr: 'Sections du panneau' },
    'Estúdios e salas': { en: 'Studios and rooms', fr: 'Studios et salles' },

    // ---- Ações e botões ----
    'Abrir': { en: 'Open', fr: 'Ouvrir' },
    'Guardar': { en: 'Save', fr: 'Enregistrer' },
    'Cancelar': { en: 'Cancel', fr: 'Annuler' },
    'Fechar': { en: 'Close', fr: 'Fermer' },
    'Adicionar': { en: 'Add', fr: 'Ajouter' },
    'Eliminar': { en: 'Delete', fr: 'Supprimer' },
    'Confirmar': { en: 'Confirm', fr: 'Confirmer' },
    'Recusar': { en: 'Decline', fr: 'Refuser' },
    'Procurar': { en: 'Search', fr: 'Rechercher' },
    'Entrar': { en: 'Sign in', fr: 'Se connecter' },
    'Sair': { en: 'Sign out', fr: 'Se déconnecter' },
    'Bloquear': { en: 'Block', fr: 'Bloquer' },
    'Nova marcação': { en: 'New booking', fr: 'Nouvelle réservation' },
    'Bloquear horário': { en: 'Block time', fr: 'Bloquer un créneau' },
    'Nova sala': { en: 'New room', fr: 'Nouvelle salle' },
    'Novo estúdio': { en: 'New studio', fr: 'Nouveau studio' },
    'Criar estúdio': { en: 'Create studio', fr: 'Créer le studio' },
    'Guardar estúdio': { en: 'Save studio', fr: 'Enregistrer le studio' },
    'Eliminar estúdio': { en: 'Delete studio', fr: 'Supprimer le studio' },
    'Novo serviço': { en: 'New service', fr: 'Nouveau service' },
    'Novo utilizador': { en: 'New user', fr: 'Nouvel utilisateur' },
    'Guardar definições': { en: 'Save settings', fr: 'Enregistrer les paramètres' },
    'Exportar CSV': { en: 'Export CSV', fr: 'Exporter CSV' },
    'Baixar PDF': { en: 'Download PDF', fr: 'Télécharger le PDF' },
    'Sincronizar agora': { en: 'Sync now', fr: 'Synchroniser' },
    'Ver o site': { en: 'View site', fr: 'Voir le site' },
    'Enviar por WhatsApp': { en: 'Send via WhatsApp', fr: 'Envoyer par WhatsApp' },
    'Alterar palavra-passe': { en: 'Change password', fr: 'Changer le mot de passe' },
    'Estou aqui': { en: "I'm here", fr: 'Je suis ici' },
    'Dia anterior': { en: 'Previous day', fr: 'Jour précédent' },
    'Dia seguinte': { en: 'Next day', fr: 'Jour suivant' },

    // ---- Dashboard / Painel ----
    'Pedidos por confirmar': { en: 'Pending requests', fr: 'Demandes à confirmer' },
    'Sessões hoje': { en: 'Sessions today', fr: "Séances aujourd'hui" },
    'Próximos 7 dias': { en: 'Next 7 days', fr: '7 prochains jours' },
    'Recebido este mês': { en: 'Received this month', fr: 'Reçu ce mois-ci' },
    'Por receber': { en: 'Outstanding', fr: 'À recevoir' },
    'Não há pedidos à espera.': { en: 'No requests waiting.', fr: 'Aucune demande en attente.' },
    'Nenhuma sessão marcada para hoje.': { en: 'No sessions booked for today.', fr: 'Aucune séance prévue aujourd’hui.' },
    'Ainda não há marcações para resumir em gráficos.': { en: 'No bookings yet to chart.', fr: 'Pas encore de réservations à représenter.' },
    'Marcações por estado': { en: 'Bookings by status', fr: 'Réservations par statut' },
    'Marcações por serviço': { en: 'Bookings by service', fr: 'Réservations par service' },
    'Receita': { en: 'Revenue', fr: 'Recettes' },
    'marcações': { en: 'bookings', fr: 'réservations' },
    'sessões': { en: 'sessions', fr: 'séances' },
    'recebido': { en: 'received', fr: 'reçu' },

    // ---- Estados ----
    'Pedido': { en: 'Requested', fr: 'Demandé' },
    'Confirmado': { en: 'Confirmed', fr: 'Confirmé' },
    'Em curso': { en: 'In progress', fr: 'En cours' },
    'Concluído': { en: 'Completed', fr: 'Terminé' },
    'Cancelado': { en: 'Cancelled', fr: 'Annulé' },
    'À distância': { en: 'Remote', fr: 'À distance' },

    // ---- Marcações (tabela e separadores) ----
    'Por confirmar': { en: 'To confirm', fr: 'À confirmer' },
    'Próximas': { en: 'Upcoming', fr: 'À venir' },
    'Passadas': { en: 'Past', fr: 'Passées' },
    'Todas': { en: 'All', fr: 'Toutes' },
    'Data e hora': { en: 'Date and time', fr: 'Date et heure' },
    'Estúdio e sala': { en: 'Studio and room', fr: 'Studio et salle' },
    'Cliente': { en: 'Client', fr: 'Client' },
    'Trabalho': { en: 'Work', fr: 'Travail' },
    'Estado': { en: 'Status', fr: 'Statut' },
    'Valor': { en: 'Amount', fr: 'Montant' },
    'Pago': { en: 'Paid', fr: 'Payé' },
    'Por pagar': { en: 'Unpaid', fr: 'Impayé' },
    'Falta ': { en: 'Owing ', fr: 'Reste ' },
    'Sem projeto indicado': { en: 'No project given', fr: 'Aucun projet indiqué' },
    'Sem marcações para mostrar.': { en: 'No bookings to show.', fr: 'Aucune réservation à afficher.' },
    'Nenhuma marcação corresponde à pesquisa.': { en: 'No booking matches the search.', fr: 'Aucune réservation ne correspond à la recherche.' },
    'A mostrar as primeiras 500 marcações. Use a pesquisa para refinar.': { en: 'Showing the first 500 bookings. Use search to refine.', fr: 'Affichage des 500 premières réservations. Affinez par la recherche.' },
    'Nome, telefone, projeto ou código': { en: 'Name, phone, project or code', fr: 'Nom, téléphone, projet ou code' },
    'Todos os estados': { en: 'All statuses', fr: 'Tous les statuts' },
    'Todos os estúdios': { en: 'All studios', fr: 'Tous les studios' },
    'Todos os serviços': { en: 'All services', fr: 'Tous les services' },
    'Filtrar por estúdio': { en: 'Filter by studio', fr: 'Filtrer par studio' },
    'Pesquisar': { en: 'Search', fr: 'Rechercher' },

    // ---- Clientes ----
    'Telefone': { en: 'Phone', fr: 'Téléphone' },
    'Total pago': { en: 'Total paid', fr: 'Total payé' },
    'Última sessão': { en: 'Last session', fr: 'Dernière séance' },
    'Pesquisar cliente': { en: 'Search client', fr: 'Rechercher un client' },
    'Nenhum cliente encontrado.': { en: 'No client found.', fr: 'Aucun client trouvé.' },
    'Construída a partir do histórico de marcações. Clique no telefone para abrir o WhatsApp.': { en: 'Built from the booking history. Tap the phone to open WhatsApp.', fr: "Construit à partir de l'historique des réservations. Cliquez sur le téléphone pour ouvrir WhatsApp." },

    // ---- Calendário ----
    'Dia': { en: 'Day', fr: 'Jour' },
    'Hoje': { en: 'Today', fr: "Aujourd'hui" },
    'Ainda não há estúdios ativos com salas. Crie-os em Estúdios.': { en: 'No active studios with rooms yet. Create them in Studios.', fr: 'Aucun studio actif avec des salles. Créez-les dans Studios.' },
    'Clique num horário livre para criar uma marcação, ou numa marcação para a abrir.': { en: 'Click a free slot to create a booking, or a booking to open it.', fr: 'Cliquez sur un créneau libre pour créer une réservation, ou sur une réservation pour l’ouvrir.' },
    'Zona riscada: fora do horário do estúdio.': { en: 'Hatched area: outside studio hours.', fr: 'Zone hachurée : hors des heures du studio.' },
    'Clique para remover o bloqueio': { en: 'Click to remove the block', fr: 'Cliquez pour retirer le blocage' },
    'O horário fica indisponível no site e no calendário.': { en: 'The slot becomes unavailable on the site and calendar.', fr: 'Le créneau devient indisponible sur le site et le calendrier.' },
    'Motivo': { en: 'Reason', fr: 'Motif' },
    'Ex.: manutenção, sessão própria, feriado': { en: 'E.g. maintenance, own session, holiday', fr: 'Ex. : entretien, séance personnelle, jour férié' },

    // ---- Relatórios ----
    'De': { en: 'From', fr: 'Du' },
    'Até': { en: 'To', fr: 'Au' },
    'Modo': { en: 'Mode', fr: 'Mode' },
    'Presencial e à distância': { en: 'On-site and remote', fr: 'Sur place et à distance' },
    'Só presencial': { en: 'On-site only', fr: 'Sur place seulement' },
    'Só à distância': { en: 'Remote only', fr: 'À distance seulement' },
    'Este mês': { en: 'This month', fr: 'Ce mois-ci' },
    'Mês passado': { en: 'Last month', fr: 'Mois dernier' },
    'Este ano': { en: 'This year', fr: 'Cette année' },
    'Tudo': { en: 'All', fr: 'Tout' },
    'Finanças': { en: 'Finances', fr: 'Finances' },
    'Fluxo de marcações': { en: 'Booking flow', fr: 'Flux de réservations' },
    'Faturado': { en: 'Billed', fr: 'Facturé' },
    'Recebido': { en: 'Received', fr: 'Reçu' },
    'Perdido em cancelamentos': { en: 'Lost to cancellations', fr: 'Perdu (annulations)' },
    'Sessões': { en: 'Sessions', fr: 'Séances' },
    'Horas reservadas': { en: 'Booked hours', fr: 'Heures réservées' },
    'Por estado': { en: 'By status', fr: 'Par statut' },
    'Por estúdio': { en: 'By studio', fr: 'Par studio' },
    'Por serviço': { en: 'By service', fr: 'Par service' },
    'Por mês': { en: 'By month', fr: 'Par mois' },
    'Mês': { en: 'Month', fr: 'Mois' },
    'Sem marcações no período e filtros escolhidos.': { en: 'No bookings for the chosen period and filters.', fr: 'Aucune réservation pour la période et les filtres choisis.' },
    'A calcular…': { en: 'Calculating…', fr: 'Calcul…' },
    'A exportação e o PDF incluem as primeiras 500 marcações.': { en: 'The export and PDF include the first 500 bookings.', fr: "L'export et le PDF incluent les 500 premières réservations." },

    // ---- Formulário de marcação ----
    'Marcação': { en: 'Booking', fr: 'Réservation' },
    'Sala': { en: 'Room', fr: 'Salle' },
    'Serviço': { en: 'Service', fr: 'Service' },
    'Data': { en: 'Date', fr: 'Date' },
    'Início': { en: 'Start', fr: 'Début' },
    'Fim': { en: 'End', fr: 'Fin' },
    'Projeto': { en: 'Project', fr: 'Projet' },
    'Título': { en: 'Title', fr: 'Titre' },
    'Estilo': { en: 'Style', fr: 'Style' },
    'Nome do cliente': { en: 'Client name', fr: 'Nom du client' },
    'Mensagem do cliente': { en: 'Client message', fr: 'Message du client' },
    'Notas internas (o cliente não vê)': { en: 'Internal notes (hidden from the client)', fr: 'Notes internes (le client ne voit pas)' },
    'Preço': { en: 'Price', fr: 'Prix' },
    'Valor já recebido': { en: 'Amount already received', fr: 'Montant déjà reçu' },
    'Valor total': { en: 'Total amount', fr: 'Montant total' },
    'Deixe vazio para calcular pelo preço da sala.': { en: 'Leave empty to compute from the room price.', fr: 'Laissez vide pour calculer selon le prix de la salle.' },
    'Pode ser à distância': { en: 'Can be remote', fr: 'Peut être à distance' },
    'À distância (o cliente não vem ao estúdio)': { en: "Remote (client doesn't come to the studio)", fr: 'À distance (le client ne vient pas au studio)' },
    'Pedido feito no site': { en: 'Request made on the site', fr: 'Demande faite sur le site' },
    'Criada no painel': { en: 'Created in the panel', fr: 'Créée dans le panneau' },
    'Sem serviço': { en: 'No service', fr: 'Aucun service' },
    'Enviar por WhatsApp ': { en: 'Send via WhatsApp ', fr: 'Envoyer par WhatsApp ' },

    // ---- Estúdios / salas ----
    'Nome do estúdio': { en: 'Studio name', fr: 'Nom du studio' },
    'Cidade ou ilha': { en: 'City or island', fr: 'Ville ou île' },
    'Descrição': { en: 'Description', fr: 'Description' },
    'Telefone do estúdio': { en: 'Studio phone', fr: 'Téléphone du studio' },
    'Horário de funcionamento': { en: 'Opening hours', fr: "Heures d'ouverture" },
    'Onde fica': { en: 'Location', fr: 'Emplacement' },
    'Link do Google Maps ou morada a procurar': { en: 'Google Maps link or address to search', fr: 'Lien Google Maps ou adresse à rechercher' },
    'Cole o link do Google Maps, ou escreva a morada e carregue em Procurar': { en: 'Paste the Google Maps link, or type the address and tap Search', fr: 'Collez le lien Google Maps, ou saisissez l’adresse et cliquez sur Rechercher' },
    'Usar a localização deste aparelho (tem de estar no estúdio)': { en: 'Use this device’s location (you must be at the studio)', fr: 'Utiliser la position de cet appareil (vous devez être au studio)' },
    'Latitude': { en: 'Latitude', fr: 'Latitude' },
    'Longitude': { en: 'Longitude', fr: 'Longitude' },
    'Preço por hora': { en: 'Hourly rate', fr: 'Tarif horaire' },
    'Salas': { en: 'Rooms', fr: 'Salles' },
    'Ativa': { en: 'Active', fr: 'Active' },
    'Ativo': { en: 'Active', fr: 'Actif' },
    'Inativo': { en: 'Inactive', fr: 'Inactif' },
    'Nome': { en: 'Name', fr: 'Nom' },
    'Ainda não há salas ativas.': { en: 'No active rooms yet.', fr: 'Pas encore de salles actives.' },
    'Ainda não há estúdios. Crie o primeiro com o botão acima.': { en: 'No studios yet. Create the first with the button above.', fr: 'Pas encore de studios. Créez le premier avec le bouton ci-dessus.' },
    'Crie primeiro um estúdio com pelo menos uma sala.': { en: 'First create a studio with at least one room.', fr: 'Créez d’abord un studio avec au moins une salle.' },

    // ---- Serviços ----
    'Aparecem no site e no formulário de marcação, para o cliente indicar o que precisa (gravação, mistura, masterização…). Marque "pode ser à distância" no que não obriga o cliente a vir ao estúdio, como a mistura ou a masterização.': { en: 'They appear on the site and booking form so the client can say what they need (recording, mixing, mastering…). Tick "can be remote" for work that doesn’t require the client at the studio, like mixing or mastering.', fr: 'Ils apparaissent sur le site et le formulaire pour que le client indique ce qu’il lui faut (enregistrement, mixage, mastering…). Cochez « peut être à distance » pour ce qui n’oblige pas le client à venir, comme le mixage ou le mastering.' },
    'O cliente não precisa de vir ao estúdio para este trabalho.': { en: 'The client doesn’t need to come to the studio for this work.', fr: 'Le client n’a pas besoin de venir au studio pour ce travail.' },

    // ---- Definições ----
    'Negócio e contactos': { en: 'Business and contacts', fr: 'Entreprise et contacts' },
    'Nome do negócio': { en: 'Business name', fr: "Nom de l'entreprise" },
    'Frase de apresentação': { en: 'Tagline', fr: 'Slogan' },
    'Email': { en: 'Email', fr: 'E-mail' },
    'Instagram': { en: 'Instagram', fr: 'Instagram' },
    'Spotify': { en: 'Spotify', fr: 'Spotify' },
    'YouTube': { en: 'YouTube', fr: 'YouTube' },
    'Moeda': { en: 'Currency', fr: 'Devise' },
    'Indicativo do país': { en: 'Country code', fr: 'Indicatif du pays' },
    'Regras de marcação': { en: 'Booking rules', fr: 'Règles de réservation' },
    'Bloco de tempo': { en: 'Time slot', fr: 'Pas de temps' },
    'Duração mínima (min)': { en: 'Minimum duration (min)', fr: 'Durée minimale (min)' },
    'Duração máxima (min)': { en: 'Maximum duration (min)', fr: 'Durée maximale (min)' },
    'Antecedência mínima (horas)': { en: 'Minimum lead time (hours)', fr: 'Délai minimal (heures)' },
    'Marcar até (dias)': { en: 'Book up to (days)', fr: "Réserver jusqu'à (jours)" },
    'Confirmar automaticamente os pedidos feitos no site': { en: 'Automatically confirm requests made on the site', fr: 'Confirmer automatiquement les demandes faites sur le site' },
    'Texto mostrado antes de enviar o pedido': { en: 'Text shown before sending the request', fr: 'Texte affiché avant l’envoi de la demande' },
    'Só o proprietário pode alterar as definições.': { en: 'Only the owner can change the settings.', fr: 'Seul le propriétaire peut modifier les paramètres.' },
    'As horas de início seguem este intervalo.': { en: 'Start times follow this interval.', fr: 'Les heures de début suivent cet intervalle.' },
    'Quanto tempo antes do início o cliente ainda pode marcar.': { en: 'How long before the start a client can still book.', fr: 'Combien de temps avant le début un client peut encore réserver.' },
    'Com quantos dias de avanço se aceitam marcações.': { en: 'How many days ahead bookings are accepted.', fr: 'Combien de jours à l’avance les réservations sont acceptées.' },
    'Texto mostrado a seguir aos preços, por exemplo CVE ou €.': { en: 'Text shown after prices, e.g. CVE or €.', fr: 'Texte affiché après les prix, par ex. CVE ou €.' },
    'Acrescentado a números locais nos links de WhatsApp.': { en: 'Added to local numbers in WhatsApp links.', fr: 'Ajouté aux numéros locaux dans les liens WhatsApp.' },
    'Endereço completo do perfil. Fica um ícone no rodapé do site.': { en: 'Full profile URL. An icon appears in the site footer.', fr: 'Adresse complète du profil. Une icône apparaît dans le pied de page.' },
    'Perfil de artista ou playlist do estúdio.': { en: 'Artist profile or studio playlist.', fr: "Profil d'artiste ou playlist du studio." },
    'Canal do estúdio.': { en: 'Studio channel.', fr: 'Chaîne du studio.' },
    'Por exemplo, política de cancelamento ou de sinal.': { en: 'For example, cancellation or deposit policy.', fr: "Par exemple, politique d'annulation ou d'acompte." },

    // ---- Gestão de acesso ----
    'Contas de acesso': { en: 'Access accounts', fr: 'Comptes d’accès' },
    'Perfil': { en: 'Role', fr: 'Rôle' },
    'Equipa': { en: 'Team', fr: 'Équipe' },
    'Agente de estúdio': { en: 'Studio agent', fr: 'Agent de studio' },
    'Proprietário': { en: 'Owner', fr: 'Propriétaire' },
    'Estúdio do agente': { en: 'Agent’s studio', fr: 'Studio de l’agent' },
    'Escolher estúdio…': { en: 'Choose studio…', fr: 'Choisir un studio…' },
    'Palavra-passe': { en: 'Password', fr: 'Mot de passe' },
    'Deixe vazio para manter': { en: 'Leave empty to keep', fr: 'Laissez vide pour conserver' },
    'Mínimo 8 caracteres': { en: 'At least 8 characters', fr: 'Au moins 8 caractères' },
    'Um agente de estúdio só vê e gere o seu estúdio — para quem trabalha num dos estúdios espalhados pelo mundo.': { en: 'A studio agent only sees and manages their own studio — for people working in one of the studios around the world.', fr: 'Un agent de studio ne voit et ne gère que son studio — pour ceux qui travaillent dans l’un des studios dans le monde.' },

    // ---- Palavra-passe (janela) ----
    'Palavra-passe atual': { en: 'Current password', fr: 'Mot de passe actuel' },
    'Nova palavra-passe': { en: 'New password', fr: 'Nouveau mot de passe' },
    'Confirmar nova palavra-passe': { en: 'Confirm new password', fr: 'Confirmer le nouveau mot de passe' },
    'Pelo menos 8 caracteres.': { en: 'At least 8 characters.', fr: 'Au moins 8 caractères.' },

    // ---- Login / topo / rodapé ----
    'Área de gestão': { en: 'Management area', fr: 'Espace de gestion' },
    'Entre para gerir as marcações, os estúdios e a sua equipa.': { en: 'Sign in to manage bookings, studios and your team.', fr: 'Connectez-vous pour gérer les réservations, les studios et votre équipe.' },
    'Agente': { en: 'Agent', fr: 'Agent' },
    'Idioma': { en: 'Language', fr: 'Langue' },
    'Mudar entre claro e escuro': { en: 'Toggle light and dark', fr: 'Basculer clair / sombre' },
    'Claro': { en: 'Light', fr: 'Clair' },
    'Escuro': { en: 'Dark', fr: 'Sombre' },

    // ---- Integrações ----
    'Serviços de fora ligados ao site. Ligam-se com variáveis de ambiente no servidor (ver integracoes/README.md); aqui vê-se o estado de cada um.': { en: 'External services connected to the site. They are set via environment variables on the server (see integracoes/README.md); here you can see the status of each.', fr: 'Services externes reliés au site. Ils se configurent par variables d’environnement sur le serveur (voir integracoes/README.md) ; ici on voit l’état de chacun.' },
    'Pagamentos online': { en: 'Online payments', fr: 'Paiements en ligne' },
    'Lançamentos no site': { en: 'Releases on the site', fr: 'Sorties sur le site' },

    // ---- Música à mão ----
    'Adicionar música': { en: 'Add track', fr: 'Ajouter un titre' },
    'Nova música': { en: 'New track', fr: 'Nouveau titre' },
    'Editar música': { en: 'Edit track', fr: 'Modifier le titre' },
    'Artista': { en: 'Artist', fr: 'Artiste' },
    'Data de lançamento': { en: 'Release date', fr: 'Date de sortie' },
    'Reproduções': { en: 'Plays', fr: 'Écoutes' },
    'Mostrar no site': { en: 'Show on the site', fr: 'Afficher sur le site' },
    'No site': { en: 'On the site', fr: 'Sur le site' },
    'Escondido': { en: 'Hidden', fr: 'Masqué' },
    'Música adicionada.': { en: 'Track added.', fr: 'Titre ajouté.' },
    'Música guardada.': { en: 'Track saved.', fr: 'Titre enregistré.' },
    'Música eliminada.': { en: 'Track deleted.', fr: 'Titre supprimé.' },

    // ---- Projetos ----
    'Novo projeto': { en: 'New project', fr: 'Nouveau projet' },
    'Editar projeto': { en: 'Edit project', fr: 'Modifier le projet' },
    'Tipo de projeto': { en: 'Project type', fr: 'Type de projet' },
    'Campanha de talentos': { en: 'Talent campaign', fr: 'Campagne de talents' },
    'Álbum coletivo': { en: 'Collective album', fr: 'Album collectif' },
    'Outro': { en: 'Other', fr: 'Autre' },
    'Resumo': { en: 'Summary', fr: 'Résumé' },
    'Prazo (opcional)': { en: 'Deadline (optional)', fr: 'Date limite (facultatif)' },
    'Ordem': { en: 'Order', fr: 'Ordre' },
    'Imagem (link)': { en: 'Image (link)', fr: 'Image (lien)' },
    'Aceita inscrições': { en: 'Accepts entries', fr: 'Accepte les inscriptions' },
    'Ver inscrições': { en: 'View entries', fr: 'Voir les inscriptions' },
    'Inscrições': { en: 'Entries', fr: 'Inscriptions' },
    'Fechado': { en: 'Closed', fr: 'Fermé' },
    'Novo': { en: 'New', fr: 'Nouveau' },
    'Contactado': { en: 'Contacted', fr: 'Contacté' },
    'Aceite': { en: 'Accepted', fr: 'Accepté' },
    'Arquivado': { en: 'Archived', fr: 'Archivé' },
    'Projeto criado.': { en: 'Project created.', fr: 'Projet créé.' },
    'Projeto guardado.': { en: 'Project saved.', fr: 'Projet enregistré.' },
    'Projeto eliminado.': { en: 'Project deleted.', fr: 'Projet supprimé.' },
    'Estado atualizado.': { en: 'Status updated.', fr: 'Statut mis à jour.' },
    'Inscrição eliminada.': { en: 'Entry deleted.', fr: 'Inscription supprimée.' },

    // ---- Mensagens (toasts) ----
    'Marcação guardada.': { en: 'Booking saved.', fr: 'Réservation enregistrée.' },
    'Marcação eliminada.': { en: 'Booking deleted.', fr: 'Réservation supprimée.' },
    'Pedido confirmado.': { en: 'Request confirmed.', fr: 'Demande confirmée.' },
    'Pedido recusado.': { en: 'Request declined.', fr: 'Demande refusée.' },
    'Horário bloqueado.': { en: 'Slot blocked.', fr: 'Créneau bloqué.' },
    'Bloqueio removido.': { en: 'Block removed.', fr: 'Blocage retiré.' },
    'Estúdio guardado.': { en: 'Studio saved.', fr: 'Studio enregistré.' },
    'Estúdio eliminado.': { en: 'Studio deleted.', fr: 'Studio supprimé.' },
    'Sala guardada.': { en: 'Room saved.', fr: 'Salle enregistrée.' },
    'Sala adicionada.': { en: 'Room added.', fr: 'Salle ajoutée.' },
    'Sala eliminada.': { en: 'Room deleted.', fr: 'Salle supprimée.' },
    'Serviço guardado.': { en: 'Service saved.', fr: 'Service enregistré.' },
    'Serviço adicionado.': { en: 'Service added.', fr: 'Service ajouté.' },
    'Serviço eliminado.': { en: 'Service deleted.', fr: 'Service supprimé.' },
    'Definições guardadas.': { en: 'Settings saved.', fr: 'Paramètres enregistrés.' },
    'Utilizador criado.': { en: 'User created.', fr: 'Utilisateur créé.' },
    'Utilizador guardado.': { en: 'User saved.', fr: 'Utilisateur enregistré.' },
    'Utilizador eliminado.': { en: 'User deleted.', fr: 'Utilisateur supprimé.' },
    'Palavra-passe alterada.': { en: 'Password changed.', fr: 'Mot de passe changé.' },
    'Novo pedido de marcação.': { en: 'New booking request.', fr: 'Nouvelle demande de réservation.' },
    'A confirmação não coincide com a nova palavra-passe.': { en: "The confirmation doesn't match the new password.", fr: 'La confirmation ne correspond pas au nouveau mot de passe.' },
    'A nova palavra-passe deve ter pelo menos 8 caracteres.': { en: 'The new password must be at least 8 characters.', fr: 'Le nouveau mot de passe doit comporter au moins 8 caractères.' },
    'Procurar': { en: 'Search', fr: 'Rechercher' },
    'A procurar…': { en: 'Searching…', fr: 'Recherche…' },
  };

  // Alguns textos começam por um prefixo fixo e acabam em conteúdo variável
  // (data, nome...). Aqui traduz-se só o prefixo.
  const PREFIXOS = [
    [/^Hoje, /, { en: 'Today, ', fr: "Aujourd'hui, " }],
  ];

  function traduzTexto(txt) {
    if (txt == null) return null;
    const k = txt.trim();
    if (k) {
      const e = TAB[txt] || TAB[k];
      if (e && e[lingua] != null) return txt.replace(k, e[lingua]);
    }
    for (const [re, m] of PREFIXOS) {
      if (re.test(txt) && m[lingua] != null) return txt.replace(re, m[lingua]);
    }
    return null;
  }

  const ATTRS = ['placeholder', 'title', 'aria-label'];
  function traduzElemento(el) {
    for (const a of ATTRS) {
      const v = el.getAttribute && el.getAttribute(a);
      if (v) { const t = traduzTexto(v); if (t != null) el.setAttribute(a, t); }
    }
  }

  // Traduz um nó e os seus descendentes (texto + atributos).
  function traduzir(raiz) {
    if (lingua === 'pt' || !raiz) return;
    if (raiz.nodeType === 3) { const t = traduzTexto(raiz.nodeValue); if (t != null) raiz.nodeValue = t; return; }
    if (raiz.nodeType !== 1) return;
    traduzElemento(raiz);
    const walker = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
    const textos = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) textos.push(n);
    for (const n of textos) { const t = traduzTexto(n.nodeValue); if (t != null) n.nodeValue = t; }
    for (const el of raiz.querySelectorAll('[placeholder],[title],[aria-label]')) traduzElemento(el);
  }

  let obs = null;
  function observar(ligar) {
    if (obs) { obs.disconnect(); obs = null; }
    if (!ligar) return;
    obs = new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) traduzir(n);
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  window.I18N = {
    t: (chave, valores) => D.t(lingua, chave, valores),
    get lingua() { return lingua; },
    get locale() { return D.lingua(lingua).locale; },
    lista: (chave) => D.t(lingua, chave).split(','),
    traduzir,
    // Começa a traduzir (chamado no arranque do painel).
    arranque() { observar(lingua !== 'pt'); if (lingua !== 'pt') traduzir(document.body); },
    // Muda a língua: guarda, liga/desliga o observador e avisa quem desenha.
    definir(nova) {
      if (!COD.includes(nova) || nova === lingua) return;
      lingua = nova;
      try { localStorage.setItem('admin-lingua', nova); } catch (_) { /* navegação privada */ }
      document.cookie = 'lingua=' + nova + ';path=/;max-age=31536000;samesite=lax';
      document.documentElement.lang = nova;
      observar(nova !== 'pt');
      document.dispatchEvent(new CustomEvent('lingua', { detail: { lingua: nova } }));
    },
  };
})();
