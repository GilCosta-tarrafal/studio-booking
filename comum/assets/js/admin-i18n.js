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

    // ---- O Meu Perfil ----
    'O Meu Perfil': { en: 'My Profile', fr: 'Mon profil' },
    'Terminar sessão': { en: 'Sign out', fr: 'Se déconnecter' },
    'Gira os seus dados pessoais, segurança e atividade da conta.': { en: 'Manage your personal details, security and account activity.', fr: 'Gérez vos données personnelles, la sécurité et l’activité du compte.' },
    'Secções do perfil': { en: 'Profile sections', fr: 'Sections du profil' },
    'Dados pessoais': { en: 'Personal details', fr: 'Données personnelles' },
    'Conta e acessos': { en: 'Account and access', fr: 'Compte et accès' },
    'Segurança': { en: 'Security', fr: 'Sécurité' },
    'Atividade': { en: 'Activity', fr: 'Activité' },
    'Membro desde': { en: 'Member since', fr: 'Membre depuis' },
    'Último acesso': { en: 'Last seen', fr: 'Dernier accès' },
    'Último login': { en: 'Last sign-in', fr: 'Dernière connexion' },
    'Ações (30 dias)': { en: 'Actions (30 days)', fr: 'Actions (30 jours)' },
    'Logins (30 dias)': { en: 'Sign-ins (30 days)', fr: 'Connexions (30 jours)' },
    'Erros (30 dias)': { en: 'Errors (30 days)', fr: 'Erreurs (30 jours)' },
    'completo': { en: 'complete', fr: 'complet' },
    'Administrador': { en: 'Administrator', fr: 'Administrateur' },
    'Responsável': { en: 'Manager', fr: 'Responsable' },
    'Nome e contactos usados no painel e nas notificações.': { en: 'Name and contact details used in the panel and notifications.', fr: 'Nom et coordonnées utilisés dans le panneau et les notifications.' },
    'O seu papel, estado e o que pode fazer no painel.': { en: 'Your role, status and what you can do in the panel.', fr: 'Votre rôle, votre statut et ce que vous pouvez faire dans le panneau.' },
    'Use uma palavra-passe forte que não utilize noutros sítios.': { en: "Use a strong password you don't use anywhere else.", fr: 'Utilisez un mot de passe fort que vous n’utilisez nulle part ailleurs.' },
    'Logins, saídas e alterações feitas com esta conta.': { en: 'Sign-ins, sign-outs and changes made with this account.', fr: 'Connexions, déconnexions et modifications faites avec ce compte.' },
    'Nome completo *': { en: 'Full name *', fr: 'Nom complet *' },
    'Email *': { en: 'Email *', fr: 'E-mail *' },
    'O email é também o login.': { en: 'Your email is also your sign-in.', fr: 'L’e-mail sert aussi d’identifiant.' },
    'Necessária para mudar o email, que é também o login.': { en: 'Required to change your email, which is also your sign-in.', fr: 'Nécessaire pour changer l’e-mail, qui sert aussi d’identifiant.' },
    'Guardar alterações': { en: 'Save changes', fr: 'Enregistrer les modifications' },
    'Descartar': { en: 'Discard', fr: 'Annuler les modifications' },
    'Dados pessoais guardados.': { en: 'Personal details saved.', fr: 'Données personnelles enregistrées.' },
    'Como proprietário, gere estes dados de todas as contas em Utilizadores.': { en: 'As the owner, you manage these for every account in Users.', fr: 'En tant que propriétaire, vous gérez ces données pour tous les comptes dans Utilisateurs.' },
    'Geridos pelo proprietário. Peça-lhe para os alterar.': { en: 'Managed by the owner. Ask them to change these.', fr: 'Gérés par le propriétaire. Demandez-lui de les modifier.' },
    'Função': { en: 'Role', fr: 'Fonction' },
    'Estúdio': { en: 'Studio', fr: 'Studio' },
    'Criado': { en: 'Created', fr: 'Créé' },
    'ID do utilizador': { en: 'User ID', fr: 'ID utilisateur' },
    'Copiar ID do utilizador': { en: 'Copy user ID', fr: 'Copier l’ID utilisateur' },
    'Copiar': { en: 'Copy', fr: 'Copier' },
    'ID copiado.': { en: 'ID copied.', fr: 'ID copié.' },
    'Permissões': { en: 'Permissions', fr: 'Autorisations' },
    'Acesso total (administrador)': { en: 'Full access (administrator)', fr: 'Accès total (administrateur)' },
    'Acesso de equipa (todos os estúdios)': { en: 'Team access (all studios)', fr: 'Accès équipe (tous les studios)' },
    'Ainda usa a palavra-passe que lhe foi dada. Escolha uma sua.': { en: "You're still using the password you were given. Choose your own.", fr: 'Vous utilisez encore le mot de passe reçu. Choisissez le vôtre.' },
    'Mostrar palavra-passe': { en: 'Show password', fr: 'Afficher le mot de passe' },
    'Pelo menos 8 caracteres': { en: 'At least 8 characters', fr: 'Au moins 8 caractères' },
    'Uma letra maiúscula': { en: 'An uppercase letter', fr: 'Une majuscule' },
    'Uma letra minúscula': { en: 'A lowercase letter', fr: 'Une minuscule' },
    'Um número': { en: 'A number', fr: 'Un chiffre' },
    'Um símbolo': { en: 'A symbol', fr: 'Un symbole' },
    'A confirmação não coincide.': { en: "The confirmation doesn't match.", fr: 'La confirmation ne correspond pas.' },
    'Alterações': { en: 'Changes', fr: 'Modifications' },
    'Erros': { en: 'Errors', fr: 'Erreurs' },
    'Atualizar': { en: 'Refresh', fr: 'Actualiser' },
    'Filtrar atividade': { en: 'Filter activity', fr: 'Filtrer l’activité' },
    'A carregar…': { en: 'Loading…', fr: 'Chargement…' },
    'Sem atividade registada.': { en: 'No activity recorded.', fr: 'Aucune activité enregistrée.' },
    'Login efetuado no painel': { en: 'Signed in to the panel', fr: 'Connexion au panneau' },
    'Sessão terminada no painel': { en: 'Signed out of the panel', fr: 'Déconnexion du panneau' },
    'Tentativa de login falhada': { en: 'Failed sign-in attempt', fr: 'Tentative de connexion échouée' },
    'Alterou a palavra-passe': { en: 'Changed the password', fr: 'A changé le mot de passe' },
    'Tentativa de alterar a palavra-passe falhada': { en: 'Failed attempt to change the password', fr: 'Tentative de changement de mot de passe échouée' },
    'Atualizou os dados pessoais': { en: 'Updated personal details', fr: 'A mis à jour ses données personnelles' },
    // ---- Faturas e IVA ----
    'País (para o IVA)': { en: 'Country (for VAT)', fr: 'Pays (pour la TVA)' },
    'Taxa de IVA (%)': { en: 'VAT rate (%)', fr: 'Taux de TVA (%)' },
    'Sai da localização do estúdio': { en: 'Comes from the studio location', fr: 'Déduit de l’emplacement du studio' },
    'Proposta pela localização. Os preços já incluem este imposto.': { en: 'Suggested from the location. Prices already include this tax.', fr: 'Proposé selon l’emplacement. Les prix incluent déjà cette taxe.' },
    'A ver o país deste sítio…': { en: 'Checking the country of this place…', fr: 'Recherche du pays de cet endroit…' },
    'Não foi possível saber o país deste sítio. Escreva a taxa de IVA à mão.': { en: 'Could not tell the country of this place. Type the VAT rate.', fr: 'Impossible de connaître le pays de cet endroit. Saisissez le taux de TVA.' },
    'Emitir fatura': { en: 'Issue invoice', fr: 'Émettre la facture' },
    'Anular fatura': { en: 'Void invoice', fr: 'Annuler la facture' },
    'Fatura anulada.': { en: 'Invoice voided.', fr: 'Facture annulée.' },
    'Nome na fatura': { en: 'Name on invoice', fr: 'Nom sur la facture' },
    'NIF do cliente': { en: 'Client tax ID (NIF)', fr: 'NIF du client' },
    'Morada do cliente': { en: 'Client address', fr: 'Adresse du client' },
    'Vazio: consumidor final': { en: 'Empty: final consumer', fr: 'Vide : consommateur final' },

    // ---- Recibo ----
    'Recibo (PDF)': { en: 'Receipt (PDF)', fr: 'Reçu (PDF)' },
    'Dados para o recibo': { en: 'Receipt details', fr: 'Données du reçu' },
    'Aparecem no canto superior direito do recibo das marcações deste estúdio, com o telefone e a morada.': { en: 'Shown in the top-right corner of this studio’s booking receipts, with the phone and address.', fr: 'Affichées en haut à droite des reçus des réservations de ce studio, avec le téléphone et l’adresse.' },
    'NIF': { en: 'Tax ID (NIF)', fr: 'NIF' },
    'Nome no recibo': { en: 'Name on receipt', fr: 'Nom sur le reçu' },
    'Razão social, por exemplo.': { en: 'The legal company name, for example.', fr: 'La raison sociale, par exemple.' },
    'Vazio: usa o nome do estúdio': { en: 'Empty: uses the studio name', fr: 'Vide : utilise le nom du studio' },
    'Email do estúdio': { en: 'Studio email', fr: 'E-mail du studio' },

    // ---- Projetos: gravação prolongada ----
    'Gravação prolongada (com artista)': { en: 'Extended recording (with an artist)', fr: 'Enregistrement prolongé (avec un artiste)' },
    'Durante este período, a sala fica bloqueada nesse horário e o estúdio não aceita outras marcações. Se já houver uma marcação que coincida, o projeto não é guardado e o erro diz qual é.': { en: 'During this period the room is blocked at those hours and the studio takes no other bookings. If an existing booking overlaps, the project is not saved and the error says which one.', fr: 'Pendant cette période, la salle est bloquée à ces heures et le studio n’accepte pas d’autres réservations. Si une réservation existante chevauche, le projet n’est pas enregistré et l’erreur indique laquelle.' },
    'Um artista fica com uma sala durante um período. Não aparece no site: serve para bloquear a agenda.': { en: 'An artist takes a room for a period. Not shown on the site: it blocks the schedule.', fr: 'Un artiste occupe une salle pendant une période. N’apparaît pas sur le site : sert à bloquer l’agenda.' },
    'Escolha a sala': { en: 'Choose the room', fr: 'Choisissez la salle' },
    'Primeiro dia': { en: 'First day', fr: 'Premier jour' },
    'Último dia': { en: 'Last day', fr: 'Dernier jour' },
    'O dia inteiro': { en: 'All day', fr: 'Toute la journée' },
    'Das': { en: 'From', fr: 'De' },
    'Às': { en: 'To', fr: 'À' },
    'o dia inteiro': { en: 'all day', fr: 'toute la journée' },
    ' · sala bloqueada': { en: ' · room blocked', fr: ' · salle bloquée' },
    'Sala removida': { en: 'Room removed', fr: 'Salle supprimée' },

    // ---- Configurações e catálogos ----
    'Configurações': { en: 'Settings', fr: 'Configuration' },
    'Listas, definições e integrações do estúdio, num só sítio.': { en: 'Studio lists, settings and integrations, all in one place.', fr: 'Listes, paramètres et intégrations du studio, au même endroit.' },
    'Secções de configuração': { en: 'Settings sections', fr: 'Sections de configuration' },
    'Geral': { en: 'General', fr: 'Général' },
    'Catálogos': { en: 'Lists', fr: 'Listes' },
    'Definições do negócio': { en: 'Business settings', fr: 'Paramètres de l’entreprise' },
    'Géneros musicais': { en: 'Music genres', fr: 'Genres musicaux' },
    'Tipos de projeto': { en: 'Project types', fr: 'Types de projet' },
    'Tipos de cliente': { en: 'Client types', fr: 'Types de client' },
    'Métodos de pagamento': { en: 'Payment methods', fr: 'Moyens de paiement' },
    'Estados de marcação': { en: 'Booking statuses', fr: 'Statuts de réservation' },
    'Os estilos que o estúdio produz. Aparecem ao criar uma marcação.': { en: 'The styles the studio produces. They appear when creating a booking.', fr: 'Les styles produits par le studio. Ils apparaissent lors de la création d’une réservation.' },
    'O que se está a gravar: um single, um álbum, um jingle…': { en: 'What is being recorded: a single, an album, a jingle…', fr: 'Ce qui est enregistré : un single, un album, un jingle…' },
    'Quem marca: clientes normais, artistas com acordo com a gravadora…': { en: 'Who books: regular clients, artists signed to the label…', fr: 'Qui réserve : clients normaux, artistes sous contrat avec le label…' },
    'Como os clientes pagam. Escolhe-se na marcação, junto ao valor recebido.': { en: 'How clients pay. Chosen in the booking, next to the amount received.', fr: 'Comment les clients paient. À choisir dans la réservation, à côté du montant reçu.' },
    'Os passos de uma marcação. São do sistema: muda-se só a descrição.': { en: 'The steps of a booking. They belong to the system: only the description can change.', fr: 'Les étapes d’une réservation. Elles appartiennent au système : seule la description change.' },
    'Adicionar novo': { en: 'Add new', fr: 'Ajouter' },
    'Novo item': { en: 'New item', fr: 'Nouvel élément' },
    'Editar item': { en: 'Edit item', fr: 'Modifier l’élément' },
    'Código': { en: 'Code', fr: 'Code' },
    'Gerado a partir do nome': { en: 'Generated from the name', fr: 'Généré à partir du nom' },
    'Fica guardado nas marcações; depois não muda.': { en: 'Stored in bookings; it cannot change later.', fr: 'Enregistré dans les réservations ; il ne change plus ensuite.' },
    'O código não muda depois de criado.': { en: 'The code cannot change once created.', fr: 'Le code ne change plus après sa création.' },
    'Ativo (aparece nas listas de escolha)': { en: 'Active (shown in pick lists)', fr: 'Actif (apparaît dans les listes de choix)' },
    'Editar': { en: 'Edit', fr: 'Modifier' },
    'Apagar': { en: 'Delete', fr: 'Supprimer' },
    'Ativar': { en: 'Activate', fr: 'Activer' },
    'Desativar': { en: 'Deactivate', fr: 'Désactiver' },
    'Item do sistema': { en: 'System item', fr: 'Élément système' },
    'Item do sistema: não pode ser apagado nem desativado': { en: 'System item: cannot be deleted or deactivated', fr: 'Élément système : ne peut être ni supprimé ni désactivé' },
    'Item adicionado.': { en: 'Item added.', fr: 'Élément ajouté.' },
    'Item guardado.': { en: 'Item saved.', fr: 'Élément enregistré.' },
    'Item apagado.': { en: 'Item deleted.', fr: 'Élément supprimé.' },
    'Item ativado.': { en: 'Item activated.', fr: 'Élément activé.' },
    'Item desativado.': { en: 'Item deactivated.', fr: 'Élément désactivé.' },
    'Ainda não há itens. Use "Adicionar novo".': { en: 'No items yet. Use "Add new".', fr: 'Aucun élément pour l’instant. Utilisez « Ajouter ».' },
    'Género musical': { en: 'Music genre', fr: 'Genre musical' },
    'Tipo de cliente': { en: 'Client type', fr: 'Type de client' },
    'Método de pagamento': { en: 'Payment method', fr: 'Moyen de paiement' },
    'Não indicado': { en: 'Not specified', fr: 'Non indiqué' },
    'Sem género indicado': { en: 'No genre specified', fr: 'Aucun genre indiqué' },

    // ---- Sininho (notificações) ----
    'Notificações': { en: 'Notifications', fr: 'Notifications' },
    'Marcar como lidas': { en: 'Mark as read', fr: 'Marquer comme lues' },
    'Novo pedido de marcação': { en: 'New booking request', fr: 'Nouvelle demande de réservation' },
    'Veja o horário no Painel.': { en: 'See the schedule in the Panel.', fr: 'Voir l’horaire dans le Panneau.' },
    'Tentativa falhada de entrar na sua conta': { en: 'Failed attempt to sign in to your account', fr: 'Tentative de connexion échouée sur votre compte' },
    'Palavra-passe errada.': { en: 'Wrong password.', fr: 'Mot de passe incorrect.' },
    'Sem notificações. Está tudo em dia.': { en: 'No notifications. You are all caught up.', fr: 'Aucune notification. Tout est à jour.' },
    'Tem 1 notificação por ler.': { en: 'You have 1 unread notification.', fr: 'Vous avez 1 notification non lue.' },
    '1 sessão marcada para hoje': { en: '1 session booked for today', fr: '1 séance prévue aujourd’hui' },
    '1 sessão concluída por pagar': { en: '1 completed session unpaid', fr: '1 séance terminée non payée' },

    // ---- Dashboard (gráficos) ----
    'Fluxo financeiro': { en: 'Cash flow', fr: 'Flux financier' },
    'Fluxo financeiro: faturado e recebido por mês': { en: 'Cash flow: billed and received per month', fr: 'Flux financier : facturé et encaissé par mois' },
    'Faturação por serviço': { en: 'Billing by service', fr: 'Facturation par service' },
    'vs. mês anterior (mês em curso)': { en: 'vs. previous month (month in progress)', fr: 'vs. mois précédent (mois en cours)' },
    'vs. mês anterior': { en: 'vs. previous month', fr: 'vs. mois précédent' },
    'total em aberto, de todos os meses': { en: 'total outstanding, all months', fr: 'total en attente, tous les mois' },
    'Tipo de gráfico': { en: 'Chart type', fr: 'Type de graphique' },
    'Barras': { en: 'Bars', fr: 'Barres' },
    'Linha': { en: 'Line', fr: 'Ligne' },
    'Área': { en: 'Area', fr: 'Aire' },
    'Período': { en: 'Period', fr: 'Période' },
    '3 meses': { en: '3 months', fr: '3 mois' },
    '6 meses': { en: '6 months', fr: '6 mois' },
    'Ano': { en: 'Year', fr: 'Année' },
    'Ver os números em tabela': { en: 'Show the numbers as a table', fr: 'Voir les chiffres en tableau' },
    'Agenda': { en: 'Schedule', fr: 'Agenda' },
    'Outros': { en: 'Other', fr: 'Autres' },
    'sem faturação': { en: 'no billing', fr: 'aucune facturation' },
    'sessão': { en: 'session', fr: 'séance' },
    'Ainda sem faturação neste período. Os valores aparecem aqui à medida que houver marcações.': { en: 'No billing in this period yet. Figures appear here as bookings come in.', fr: 'Pas encore de facturation sur cette période. Les chiffres apparaîtront ici au fil des réservations.' },
  };

  // Alguns textos começam por um prefixo fixo e acabam em conteúdo variável
  // (data, nome...). Aqui traduz-se só o prefixo.
  const PREFIXOS = [
    [/^Hoje, /, { en: 'Today, ', fr: "Aujourd'hui, " }],
    [/^Fatura (FT \d+\/\d+) \(PDF\)$/, { en: 'Invoice $1 (PDF)', fr: 'Facture $1 (PDF)' }],
    [/^Fatura (FT \d+\/\d+) emitida\.$/, { en: 'Invoice $1 issued.', fr: 'Facture $1 émise.' }],
    [/^Taxa normal de IVA em /, { en: 'Standard VAT rate in ', fr: 'Taux normal de TVA à ' }],
    [/^Apagar "/, { en: 'Delete "', fr: 'Supprimer "' }],
    [/^Tem (d+) notificações por ler.$/, { en: 'You have $1 unread notifications.', fr: 'Vous avez $1 notifications non lues.' }],
    [/^Notificações ((d+) por ler)$/, { en: 'Notifications ($1 unread)', fr: 'Notifications ($1 non lues)' }],
    [/^(d+) sessões marcadas para hoje$/, { en: '$1 sessions booked for today', fr: '$1 séances prévues aujourd’hui' }],
    [/^(d+) sessões concluídas por pagar$/, { en: '$1 completed sessions unpaid', fr: '$1 séances terminées non payées' }],
    [/^Falta receber /, { en: 'Still to collect: ', fr: 'Reste à encaisser : ' }],
    [/^A partir de /, { en: 'From ', fr: 'Depuis ' }],
    [/^Horas de estúdio: /, { en: 'Studio hours: ', fr: 'Heures de studio : ' }],
    [/^faturado em /, { en: 'billed in ', fr: 'facturé en ' }],
    [/^Nenhuma sessão faturada em /, { en: 'No sessions billed in ', fr: 'Aucune séance facturée en ' }],
    [/^Faturação por serviço em /, { en: 'Billing by service in ', fr: 'Facturation par service en ' }],
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
