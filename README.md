# OctivSniper

Auto-booking pour les salles utilisant [Octiv Fitness](https://www.octivfitness.com). Reserve automatiquement tes cours des que la fenetre de reservation s'ouvre.

Compatible avec toute salle (CrossFit, yoga, HIIT...) qui utilise la plateforme Octiv Fitness pour ses reservations.

## Probleme

Les cours populaires se remplissent en quelques minutes apres l'ouverture des reservations. La fenetre ouvre typiquement **quelques jours avant le cours a l'heure de fin** (ex: cours dimanche 9h45-10h45, ouverture 4 jours avant → ouvre mercredi a 10h45). Le delai est configurable.

## Solution

OctivSniper surveille tes creneaux configures et lance les reservations automatiquement avec :
- **Anticipation 30s** — commence les tentatives avant l'ouverture theorique
- **Pre-fetch** — recupere l'ID du cours 2 minutes avant pour ne pas perdre de temps
- **Retry agressif** — toutes les 500ms, jusqu'a 20 tentatives
- **Reschedule auto** — apres chaque booking, programme la semaine suivante
- **Refresh token** — renouvelle automatiquement le JWT avant expiration

## Prerequis

- [Bun](https://bun.sh) >= 1.0
- Un compte Octiv Fitness

## Installation

```bash
git clone https://github.com/bnjdpn/OctivSniper.git
cd OctivSniper
bun install
bun link
```

La commande `bun link` enregistre `octiv` comme commande globale.

## Utilisation rapide

```bash
octiv
```

C'est tout. Le mode interactif te guide :

1. Connexion automatique (login si premiere utilisation)
2. Affiche les cours de la semaine
3. Selectionne ceux a reserver avec les fleches et espace
4. Le scheduler se lance automatiquement

```
  OctivSniper
  ✓ Connecte : dupinbenjam@gmail.com
  ✓ 18 cours trouves

  Selectionne les cours a reserver automatiquement :

  ▸ ● lun 17/02  07:00  WOD              3/12
    ○ lun 17/02  12:15  WOD              8/12
    ● mar 18/02  07:00  WOD              2/12
    ○ mer 19/02  07:00  WOD              5/12
    ○ dim 23/02  09:45  WOD              0/12

  ↑↓ naviguer  espace selectionner  a tout  ↵ confirmer  2 selectionne(s)
```

## Commandes avancees

Les sous-commandes restent disponibles pour le scripting :

| Commande | Description |
|----------|-------------|
| `octiv` | **Mode interactif** (recommande) |
| `octiv login` | Connexion email/mot de passe |
| `octiv add <jour> <heure> <nom>` | Ajouter un creneau (`monday`..`sunday`, `HH:MM`) |
| `octiv list` | Lister les creneaux |
| `octiv remove <index>` | Supprimer un creneau |
| `octiv next` | Prochains bookings programmes |
| `octiv test` | Test API (dry run) |
| `octiv run` | Lancer le daemon (sans menu interactif) |

Pour un fonctionnement permanent en arriere-plan :

```bash
nohup octiv run > octiv.log 2>&1 &
```

## Configuration

Le fichier `config.json` (cree automatiquement, gitignore) :

```json
{
  "auth": {
    "email": "...",
    "jwt": "...",
    "refreshToken": "...",
    "expiresAt": 0,
    "userId": 0,
    "tenantId": 0,
    "locationId": 0
  },
  "advanceBookingDays": 4,
  "slots": [
    { "day": "monday", "time": "07:00", "className": "WOD" }
  ],
  "retryIntervalMs": 500,
  "maxRetries": 20
}
```

| Parametre | Description | Default |
|-----------|-------------|---------|
| `advanceBookingDays` | Jours d'avance pour l'ouverture | `4` |
| `retryIntervalMs` | Intervalle entre les tentatives (ms) | `500` |
| `maxRetries` | Nombre max de tentatives | `20` |

## Stack

- **Bun** — runtime TypeScript, zero config
- **Zero dependance runtime** — utilise les built-ins Bun (`fetch`, `Bun.sleep`, `Bun.file`)
- **Zero dependance UI** — menu interactif avec ANSI escape codes natifs
