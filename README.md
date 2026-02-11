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

## Prerequis

- [Bun](https://bun.sh) >= 1.0
- Un compte Octiv Fitness

## Installation

```bash
git clone https://github.com/bnjdpn/OctivSniper.git
cd OctivSniper
bun install
```

## Utilisation

### 1. Se connecter

```bash
bun run src/index.ts login
```

Saisir email et mot de passe. Le JWT est sauvegarde dans `config.json` (gitignore).

### 2. Ajouter des creneaux

```bash
bun run src/index.ts add monday 07:00 WOD
bun run src/index.ts add sunday 09:45 WOD
bun run src/index.ts add wednesday 12:15 GYMNASTICS
```

### 3. Verifier la config

```bash
bun run src/index.ts list
```

```
Configured slots:
  [0] WOD - monday at 07:00
  [1] WOD - sunday at 09:45
  [2] GYMNASTICS - wednesday at 12:15
```

### 4. Voir les prochains bookings

```bash
bun run src/index.ts next
```

```
Upcoming bookings:

  WOD - monday 07:00
    Class:   lundi 17 fevrier 2025
    Opens:   13/02/2025 08:00:00
    Attempt: 13/02/2025 07:59:30 (in 2d 14h 30m)
```

### 5. Tester la connexion API

```bash
bun run src/index.ts test
```

Verifie le JWT, liste les cours du jour, et teste le matching des creneaux configures.

### 6. Lancer le scheduler

```bash
bun run src/index.ts run
```

Le scheduler tourne en continu. Il programme des timers pour chaque creneau et tente le booking a l'heure d'ouverture. Apres chaque tentative (succes ou echec), il se reprogramme pour la semaine suivante.

Pour un fonctionnement permanent :

```bash
nohup bun run src/index.ts run > octiv.log 2>&1 &
```

## Commandes

| Commande | Description |
|----------|-------------|
| `login` | Connexion email/mot de passe |
| `add <jour> <heure> <nom>` | Ajouter un creneau (`monday`..`sunday`, `HH:MM`) |
| `list` | Lister les creneaux |
| `remove <index>` | Supprimer un creneau |
| `next` | Prochains bookings programmes |
| `test` | Test API (dry run) |
| `run` | Lancer le daemon |

## Configuration

Le fichier `config.json` (cree automatiquement, gitignore) :

```json
{
  "auth": {
    "email": "...",
    "jwt": "...",
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
