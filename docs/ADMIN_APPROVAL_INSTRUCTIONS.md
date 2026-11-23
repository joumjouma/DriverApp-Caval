# Instructions pour l'approbation des chauffeurs

## Vue d'ensemble
Tous les nouveaux comptes chauffeurs sont créés avec le statut `isApproved: false` et `approvalStatus: 'pending'`. Ils ne peuvent pas accéder à l'application tant qu'ils ne sont pas approuvés manuellement.

## Comment approuver un chauffeur

### 1. Accéder à Firebase Console
1. Allez sur [Firebase Console](https://console.firebase.google.com)
2. Sélectionnez votre projet Caval
3. Cliquez sur "Firestore Database" dans le menu de gauche

### 2. Trouver les chauffeurs en attente
1. Dans Firestore, naviguez vers la collection `Drivers`
2. Recherchez les documents avec :
   - `isApproved: false`
   - `approvalStatus: 'pending'`

### 3. Approuver un chauffeur
1. Cliquez sur le document du chauffeur
2. Modifiez les champs suivants :
   ```json
   {
     "isApproved": true,
     "approvalStatus": "approved",
     "approvalDate": "2024-01-15T10:30:00.000Z",
     "approvedBy": "admin@caval.tech"
   }
   ```
3. Cliquez sur "Update"

### 4. Rejeter un chauffeur (optionnel)
Si vous devez rejeter un chauffeur :
1. Modifiez les champs :
   ```json
   {
     "isApproved": false,
     "approvalStatus": "rejected",
     "approvalDate": "2024-01-15T10:30:00.000Z",
     "approvedBy": "admin@caval.tech"
   }
   ```

## Notifications automatiques
- Quand un chauffeur est approuvé, il recevra automatiquement une notification push
- Quand un chauffeur est rejeté, il recevra également une notification
- Les notifications sont envoyées via les Cloud Functions configurées

## Informations à vérifier avant approbation
Avant d'approuver un chauffeur, vérifiez :
- ✅ Photo de profil téléchargée
- ✅ Informations personnelles complètes
- ✅ Numéro de téléphone valide
- ✅ Au moins une méthode de paiement sélectionnée
- ✅ Type de véhicule spécifié

## Méthodes de paiement acceptées
Les chauffeurs peuvent maintenant sélectionner parmi :
- D-money
- Cac pay
- Waafi
- **Saba Pay** (nouveau)

## Support
Pour toute question concernant l'approbation des chauffeurs, contactez l'équipe technique. 